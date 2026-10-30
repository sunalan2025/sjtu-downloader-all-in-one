import type { MaskedCredential } from '@shared/types'

/**
 * 生成在 jAccount 认证页面中执行的安全自动填充与多账号悬浮面板脚本
 */
export function getAutofillScript(
  accounts: MaskedCredential[],
  isDark: boolean,
  defaultFill?: { username?: string; password?: string } | null
): string {
  const jsonAccounts = JSON.stringify(accounts)
  const jsonDefaultFill = JSON.stringify(defaultFill || null)
  const darkBool = Boolean(isDark)

  return `(() => {
  try {
    if (window.location.origin !== 'https://jaccount.sjtu.edu.cn') {
      console.warn('[Security] 凭据填充已阻止：页面 Origin 不匹配');
      return;
    }

    const accounts = ${jsonAccounts};
    const defaultFill = ${jsonDefaultFill};
    const isDark = ${darkBool};

    function setInputValue(el, val) {
      if (!el || val == null) return;
      try {
        el.focus();
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) {
          desc.set.call(el, val);
        } else {
          el.value = val;
        }
      } catch (e) {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }

    function findUserEl() {
      return document.querySelector('#passwordForm #input-login-user, #input-login-user, #user, input[name="user"], input[name="username"]');
    }
    function findPassEl() {
      return document.querySelector('#passwordForm #input-login-pass, #input-login-pass, #pass, input[name="pass"], input[type="password"]');
    }
    function findCaptchaImg() {
      return document.querySelector('#passwordForm #captcha-img, #captcha-img');
    }
    function findCaptchaInput() {
      return document.querySelector('#passwordForm #input-login-captcha, #input-login-captcha');
    }
    function findSubmitBtn() {
      return document.querySelector('#submit-password-button, #passwordForm input[type="submit"], #passwordForm button[type="submit"], #passwordForm .form-submit, input[type="submit"]');
    }

    let lastTypedPass = '';

    window.__sjtuFillCred = function(username, password) {
      const uEl = findUserEl();
      const pEl = findPassEl();
      if (uEl && username) setInputValue(uEl, username);
      if (pEl && password) {
        lastTypedPass = password;
        setInputValue(pEl, password);
      }
    };

    function captureCredentials() {
      const uEl = findUserEl();
      const pEl = findPassEl();
      if (uEl && pEl) {
        const user = (uEl.value || '').trim();
        // 优先保留表单提交/RSA加密前捕获到的明文输入
        const pass = lastTypedPass || pEl.value || '';
        if (user && pass) {
          console.log('__SJTU_CRED_CAPTURED__:' + JSON.stringify({ user, pass }));
        }
      }
    }

    if (!window.__sjtuCaptureBound) {
      window.__sjtuCaptureBound = true;

      document.addEventListener('input', function(e) {
        const t = e.target;
        if (t && (t.id === 'input-login-pass' || t.name === 'pass' || t.type === 'password')) {
          lastTypedPass = t.value || '';
        }
      }, true);

      document.addEventListener('submit', function() {
        captureCredentials();
      }, true);

      document.addEventListener('click', function(e) {
        const target = e.target;
        const el = target && target.nodeType === 1 ? target : (target && target.parentElement);
        if (el && typeof el.closest === 'function') {
          const btn = el.closest('#submit-password-button, #submit-sms-button, input[type="submit"], button[type="submit"], .form-submit, .btn-primary');
          if (btn) {
            captureCredentials();
          }

          const qrEl = el.closest('#switch-to-qr, .qr-login, .login-qr, #qr-mask, #qr-img, .qr-tips, .qr-box, #qrcode, .qrcode, [data-type="qr"], [data-tab="qr"], a[href*="qr"], .qr-btn, .switch-qr');
          if (qrEl) {
            lastTypedPass = '';
            console.log('__SJTU_CRED_CLEAR__');
          }
        }
      }, true);

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          const uEl = findUserEl();
          const pEl = findPassEl();
          if (document.activeElement === uEl || document.activeElement === pEl) {
            captureCredentials();
          }
        }
      }, true);
    }

    window.__sjtuAutoLoginCancelled = false;
    window.__sjtuPacingTimers = [];

    window.__sjtuCancelAutoLogin = function() {
      window.__sjtuAutoLoginCancelled = true;
      if (window.__sjtuPacingTimers && Array.isArray(window.__sjtuPacingTimers)) {
        window.__sjtuPacingTimers.forEach(function(t) { clearTimeout(t); });
        window.__sjtuPacingTimers = [];
      }
      console.log('__SJTU_AUTOLOGIN_CANCELLED__');
    };

    window.__sjtuClearInputs = function() {
      const uEl = findUserEl();
      const pEl = findPassEl();
      const cEl = findCaptchaInput();
      if (uEl) setInputValue(uEl, '');
      if (pEl) setInputValue(pEl, '');
      if (cEl) setInputValue(cEl, '');
    };

    function schedulePacing(fn, delay) {
      const timer = setTimeout(function() {
        if (!window.__sjtuAutoLoginCancelled) {
          fn();
        }
      }, delay);
      window.__sjtuPacingTimers.push(timer);
      return timer;
    }

    function triggerSubmit() {
      if (window.__sjtuAutoLoginCancelled) return;
      console.log('__SJTU_AUTOLOGIN_PHASE__:submitting');
      const submitBtn = findSubmitBtn();
      if (!submitBtn) return;
      if (typeof window.checkForm === 'function') {
        try {
          window.checkForm(submitBtn);
          return;
        } catch (e) {
          console.warn('[SJTU-Autofill] checkForm failed:', e);
        }
      }
      try {
        if (typeof submitBtn['click'] === 'function') {
          submitBtn['click']();
        } else {
          submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      } catch (e) {
        submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    }

    function performAutofill() {
      if (!defaultFill || !defaultFill.username) return;
      if (window.__sjtuAutoLoginCancelled) return;

      console.log('__SJTU_AUTOLOGIN_PHASE__:username');

      // 阶段 1：自然停顿后填入用户名 (200ms)
      schedulePacing(function() {
        const uEl = findUserEl();
        if (uEl) {
          setInputValue(uEl, defaultFill.username);
        }
        console.log('__SJTU_AUTOLOGIN_PHASE__:password');
      }, 200);

      // 阶段 2：自然停顿后填入密码 (500ms)
      schedulePacing(function() {
        const pEl = findPassEl();
        if (pEl && defaultFill.password) {
          setInputValue(pEl, defaultFill.password);
        }
        console.log('__SJTU_AUTOLOGIN_PHASE__:check_captcha');
        schedulePacing(function() {
          const submitted = window.__sjtuCheckNoCaptchaAndSubmit && window.__sjtuCheckNoCaptchaAndSubmit();
          if (!submitted) {
            detectAndSolveCaptcha();
          }
        }, 300);
      }, 500);
    }
    performAutofill();

    function renderDropdown(accs) {
      const oldDropdown = document.getElementById('__sjtu_cred_dropdown');
      if (oldDropdown) oldDropdown.remove();
      const oldToggle = document.getElementById('__sjtu_cred_toggle');
      if (oldToggle) oldToggle.remove();

      if (!accs || accs.length <= 1) return;

      const userEl = findUserEl();
      if (!userEl) return;

      const container = userEl.closest('.input-control') || userEl.parentElement;
      if (!container) return;

      if (window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      userEl.style.paddingRight = '68px';

      const bg = isDark ? '#232323' : '#FFFFFF';
      const text = isDark ? '#F5F5F5' : '#1D2129';
      const textSub = isDark ? '#A0A0A0' : '#86909C';
      const border = isDark ? '#3D3D3D' : '#E5E6EB';
      const hoverBg = isDark ? '#2D2D2D' : '#F2F3F5';
      const shadow = isDark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 24px rgba(0,0,0,0.12)';
      const accent = isDark ? '#4080FF' : '#165DFF';
      const badgeBg = isDark ? 'rgba(64,128,255,0.18)' : 'rgba(22,93,255,0.08)';
      const badgeColor = isDark ? '#69B1FF' : '#165DFF';

      const toggle = document.createElement('div');
      toggle.id = '__sjtu_cred_toggle';
      toggle.title = '切换已保存的 jAccount 账号';
      toggle.style.position = 'absolute';
      toggle.style.right = '8px';
      toggle.style.top = '50%';
      toggle.style.transform = 'translateY(-50%)';
      toggle.style.zIndex = '5';
      toggle.style.fontSize = '11px';
      toggle.style.fontWeight = '500';
      toggle.style.padding = '2px 7px';
      toggle.style.borderRadius = '4px';
      toggle.style.background = badgeBg;
      toggle.style.color = badgeColor;
      toggle.style.cursor = 'pointer';
      toggle.style.userSelect = 'none';
      toggle.style.display = 'flex';
      toggle.style.alignItems = 'center';
      toggle.style.gap = '3px';
      toggle.style.transition = 'opacity 0.15s';

      const toggleSpan = document.createElement('span');
      toggleSpan.textContent = accs.length + '个账号';
      const arrowSpan = document.createElement('span');
      arrowSpan.style.fontSize = '9px';
      arrowSpan.textContent = '▼';
      toggle.appendChild(toggleSpan);
      toggle.appendChild(arrowSpan);
      container.appendChild(toggle);

      const dropdown = document.createElement('div');
      dropdown.id = '__sjtu_cred_dropdown';
      dropdown.style.position = 'absolute';
      dropdown.style.top = 'calc(100% + 4px)';
      dropdown.style.left = '0';
      dropdown.style.width = '100%';
      dropdown.style.boxSizing = 'border-box';
      dropdown.style.background = bg;
      dropdown.style.border = '1px solid ' + border;
      dropdown.style.borderRadius = '10px';
      dropdown.style.boxShadow = shadow;
      dropdown.style.zIndex = '99999';
      dropdown.style.display = 'none';
      dropdown.style.maxHeight = '220px';
      dropdown.style.overflowY = 'auto';
      dropdown.style.fontFamily = 'inherit';

      accs.forEach(function(acc) {
        const itemEl = document.createElement('div');
        itemEl.className = '__sjtu_cred_item';
        itemEl.setAttribute('data-id', acc.id);
        itemEl.style.display = 'flex';
        itemEl.style.alignItems = 'center';
        itemEl.style.justifyContent = 'space-between';
        itemEl.style.padding = '8px 12px';
        itemEl.style.cursor = 'pointer';
        itemEl.style.borderBottom = '1px solid ' + border;
        itemEl.style.transition = 'background 0.12s';

        const infoEl = document.createElement('div');
        infoEl.style.flex = '1';
        infoEl.style.minWidth = '0';
        infoEl.style.paddingRight = '8px';

        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '6px';
        topRow.style.marginBottom = '2px';

        const userSpan = document.createElement('span');
        userSpan.style.fontSize = '13px';
        userSpan.style.fontWeight = '600';
        userSpan.style.color = text;
        userSpan.style.overflow = 'hidden';
        userSpan.style.textOverflow = 'ellipsis';
        userSpan.style.whiteSpace = 'nowrap';
        userSpan.textContent = acc.username;
        topRow.appendChild(userSpan);

        if (acc.label) {
          const labelBadge = document.createElement('span');
          labelBadge.style.fontSize = '10px';
          labelBadge.style.padding = '1px 5px';
          labelBadge.style.borderRadius = '4px';
          labelBadge.style.background = badgeBg;
          labelBadge.style.color = badgeColor;
          labelBadge.style.fontWeight = '500';
          labelBadge.textContent = acc.label;
          topRow.appendChild(labelBadge);
        }
        infoEl.appendChild(topRow);

        const botRow = document.createElement('div');
        botRow.style.fontSize = '11px';
        botRow.style.color = textSub;
        botRow.style.display = 'flex';
        botRow.style.alignItems = 'center';
        botRow.style.gap = '4px';

        const passSpan = document.createElement('span');
        passSpan.style.letterSpacing = '1px';
        passSpan.textContent = acc.maskedPassword || '••••••••';
        botRow.appendChild(passSpan);
        infoEl.appendChild(botRow);

        itemEl.appendChild(infoEl);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = '__sjtu_cred_del_btn';
        delBtn.setAttribute('data-id', acc.id);
        delBtn.title = '删除此账号';
        delBtn.textContent = '✕';
        delBtn.style.background = 'transparent';
        delBtn.style.border = 'none';
        delBtn.style.color = textSub;
        delBtn.style.cursor = 'pointer';
        delBtn.style.padding = '4px 6px';
        delBtn.style.borderRadius = '4px';
        delBtn.style.fontSize = '13px';
        delBtn.style.lineHeight = '1';
        delBtn.style.transition = 'all 0.12s';

        delBtn.onmouseenter = function() {
          delBtn.style.color = '#FF4D4F';
          delBtn.style.background = isDark ? 'rgba(255,77,79,0.2)' : 'rgba(255,77,79,0.1)';
        };
        delBtn.onmouseleave = function() {
          delBtn.style.color = textSub;
          delBtn.style.background = 'transparent';
        };
        delBtn.onclick = function(e) {
          e.stopPropagation();
          console.log('__SJTU_CRED_DELETE__:' + acc.id);
          itemEl.remove();
          const remaining = dropdown.querySelectorAll('.__sjtu_cred_item');
          if (remaining.length <= 1) {
            dropdown.remove();
            toggle.remove();
            userEl.style.paddingRight = '10px';
          } else {
            toggleSpan.textContent = remaining.length + '个账号';
          }
        };

        itemEl.appendChild(delBtn);

        itemEl.onmouseenter = function() {
          itemEl.style.background = hoverBg;
        };
        itemEl.onmouseleave = function() {
          itemEl.style.background = 'transparent';
        };
        itemEl.onclick = function(e) {
          if (e.target && e.target.closest('.__sjtu_cred_del_btn')) return;
          console.log('__SJTU_CRED_SELECT__:' + acc.id);
          closeMenu();
        };

        dropdown.appendChild(itemEl);
      });

      const newAccEl = document.createElement('div');
      newAccEl.className = '__sjtu_cred_new_acc';
      newAccEl.style.display = 'flex';
      newAccEl.style.alignItems = 'center';
      newAccEl.style.gap = '6px';
      newAccEl.style.padding = '8px 12px';
      newAccEl.style.cursor = 'pointer';
      newAccEl.style.fontSize = '12px';
      newAccEl.style.color = accent;
      newAccEl.style.fontWeight = '500';
      newAccEl.style.transition = 'background 0.12s';
      newAccEl.innerHTML = '<span>+</span><span>使用其他账号登录</span>';
      newAccEl.onmouseenter = function() {
        newAccEl.style.background = hoverBg;
      };
      newAccEl.onmouseleave = function() {
        newAccEl.style.background = 'transparent';
      };
      newAccEl.onclick = function() {
        const uEl = findUserEl();
        const pEl = findPassEl();
        if (uEl) {
          setInputValue(uEl, '');
          uEl.focus();
        }
        if (pEl) {
          setInputValue(pEl, '');
        }
        closeMenu();
      };
      dropdown.appendChild(newAccEl);

      container.appendChild(dropdown);

      function openMenu() {
        dropdown.style.display = 'block';
      }
      function closeMenu() {
        dropdown.style.display = 'none';
      }
      function toggleMenu() {
        if (dropdown.style.display === 'block') {
          closeMenu();
        } else {
          openMenu();
        }
      }

      toggle.onclick = function(e) {
        e.stopPropagation();
        toggleMenu();
      };
      userEl.onfocus = function() {
        openMenu();
      };
      userEl.onclick = function(e) {
        e.stopPropagation();
        openMenu();
      };

      if (!window.__sjtuDropdownGlobalBound) {
        window.__sjtuDropdownGlobalBound = true;

        document.addEventListener('click', function(e) {
          const curDropdown = document.getElementById('__sjtu_cred_dropdown');
          const curToggle = document.getElementById('__sjtu_cred_toggle');
          const curUserEl = findUserEl();
          if (curDropdown && curDropdown.style.display !== 'none') {
            const target = e.target;
            if (
              !curDropdown.contains(target) &&
              target !== curUserEl &&
              (!curToggle || !curToggle.contains(target))
            ) {
              curDropdown.style.display = 'none';
            }
          }
        });

        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') {
            const curDropdown = document.getElementById('__sjtu_cred_dropdown');
            if (curDropdown) {
              curDropdown.style.display = 'none';
            }
          }
        });
      }
    }

    renderDropdown(accounts);

    window.__sjtuUpdateAccounts = function(updatedAccs) {
      renderDropdown(updatedAccs);
    };

    // ─── 验证码自动识别与自动提交 (geek.sjtu.edu.cn/captcha-solver) ───
    let captchaAttempts = 0;
    const MAX_CAPTCHA_ATTEMPTS = 3;

    function detectAndSolveCaptcha() {
      if (window.__sjtuAutoLoginCancelled) return;
      if (captchaAttempts >= MAX_CAPTCHA_ATTEMPTS) return;
      const img = findCaptchaImg();
      const captchaInput = findCaptchaInput();
      if (!img || !captchaInput) return;

      if (!img.complete || img.naturalWidth === 0) {
        img.addEventListener('load', () => schedulePacing(detectAndSolveCaptcha, 100), { once: true });
        return;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 110;
        canvas.height = img.naturalHeight || 40;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        if (dataUrl && dataUrl.length > 100) {
          captchaAttempts++;
          console.log('__SJTU_SOLVE_CAPTCHA__:' + dataUrl);
        }
      } catch (err) {
        console.warn('[SJTU-Autofill] capture captcha canvas failed:', err);
      }
    }

    window.__sjtuGetCaptchaDataUrl = function() {
      const img = findCaptchaImg();
      if (!img || !img.complete || img.naturalWidth === 0) return null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 110;
        canvas.height = img.naturalHeight || 40;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/jpeg', 0.95);
      } catch {
        return null;
      }
    };

    window.__sjtuCheckNoCaptchaAndSubmit = function() {
      if (window.__sjtuAutoLoginCancelled) return false;
      const captchaBox = document.querySelector('#captcha-box');
      const operateButtons = document.querySelector('#operate-buttons');
      const uEl = findUserEl();
      const pEl = findPassEl();
      const hasCreds = Boolean(uEl && uEl.value && pEl && pEl.value);
      if (!hasCreds) return false;

      // 若无需输入验证码 (如风控环境检测通过，captcha-box 保持隐藏且 operateButtons 已展示)
      const isCaptchaHidden = !captchaBox || captchaBox.style.display === 'none' || (window.getComputedStyle && window.getComputedStyle(captchaBox).display === 'none');
      const isOperateVisible = Boolean(operateButtons && (operateButtons.style.display !== 'none' || (window.getComputedStyle && window.getComputedStyle(operateButtons).display !== 'none')));

      if (isCaptchaHidden && isOperateVisible) {
        schedulePacing(function() {
          triggerSubmit();
        }, 450);
        return true;
      }
      return false;
    };

    window.__sjtuFillCaptchaAndSubmit = function(code) {
      if (window.__sjtuAutoLoginCancelled) return;
      const captchaInput = findCaptchaInput();
      if (captchaInput && code) {
        setInputValue(captchaInput, code);
      }
      const uEl = findUserEl();
      const pEl = findPassEl();
      // 若凭据尚未完全填入，立即强行补全默认账号密码，防止时序竞争
      if (defaultFill) {
        if (uEl && (!uEl.value || uEl.value !== defaultFill.username) && defaultFill.username) {
          setInputValue(uEl, defaultFill.username);
        }
        if (pEl && !pEl.value && defaultFill.password) {
          setInputValue(pEl, defaultFill.password);
        }
      }
      schedulePacing(function() {
        triggerSubmit();
      }, 300);
    };

    // 监听 jAccount 登录失败与错误提示（如验证码错误、用户名密码错误）
    const warnSpan = document.querySelector('#span_warn');
    if (warnSpan && window.MutationObserver) {
      const warnObserver = new MutationObserver(() => {
        const text = (warnSpan.textContent || '').trim();
        const warnDiv = document.querySelector('#div_warn');
        const isVisible = Boolean(warnDiv && (warnDiv.style.display !== 'none' && warnDiv.style.display !== ''));
        if (text && isVisible) {
          console.log('__SJTU_LOGIN_ERROR__:' + text);
        }
      });
      warnObserver.observe(warnSpan, { childList: true, characterData: true, subtree: true });
    }

    // 监听验证码图片刷新 (用户点击或验证码错误自动刷新)
    const captchaImg = findCaptchaImg();
    if (captchaImg && window.MutationObserver) {
      let lastSrc = captchaImg.src;
      const observer = new MutationObserver(() => {
        if (captchaImg.src !== lastSrc) {
          lastSrc = captchaImg.src;
          schedulePacing(detectAndSolveCaptcha, 200);
        }
      });
      observer.observe(captchaImg, { attributes: true, attributeFilter: ['src'] });
    }
  } catch (err) {
    console.error('[SJTU-Autofill] error in injected script:', err);
  }
})()`;
}

