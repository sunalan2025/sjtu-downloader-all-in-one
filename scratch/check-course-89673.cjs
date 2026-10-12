const { app, session } = require('electron');
const path = require('path');

app.setPath('userData', path.join(process.env.APPDATA, 'sjtu-course-downloader'));

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:sjtu');
    const courseId = 89673;

    // Check cookies
    const cookies = await ses.cookies.get({ domain: 'oc.sjtu.edu.cn' });
    console.log(`Canvas cookies found: ${cookies.length}`);

    console.log('=== Checking Course Info ===');
    const courseResp = await ses.fetch(`https://oc.sjtu.edu.cn/api/v1/courses/${courseId}`);
    console.log('Course status:', courseResp.status);
    if (courseResp.ok) {
      const course = await courseResp.json();
      console.log('Course name:', course.name, 'id:', course.id);
    } else {
      console.log('Course error:', await courseResp.text());
    }

    console.log('\n=== Checking Tabs ===');
    const tabsResp = await ses.fetch(`https://oc.sjtu.edu.cn/api/v1/courses/${courseId}/tabs?per_page=100`);
    console.log('Tabs status:', tabsResp.status);
    let tabs = [];
    if (tabsResp.ok) {
      tabs = await tabsResp.json();
      for (const t of tabs) {
        console.log(`Tab: id=${t.id}, label=${t.label}, type=${t.type}, hidden=${t.hidden}, visibility=${t.visibility}, url=${t.html_url}`);
      }
    }

    console.log('\n=== Checking Modules ===');
    const modResp = await ses.fetch(`https://oc.sjtu.edu.cn/api/v1/courses/${courseId}/modules?per_page=100`);
    console.log('Modules status:', modResp.status);
    if (modResp.ok) {
      const modules = await modResp.json();
      console.log('Total modules:', modules.length);
      for (const m of modules) {
        console.log(`Module: id=${m.id}, name=${m.name}, items_count=${m.items_count}`);
        const itemsResp = await ses.fetch(`https://oc.sjtu.edu.cn/api/v1/courses/${courseId}/modules/${m.id}/items?per_page=100`);
        if (itemsResp.ok) {
          const items = await itemsResp.json();
          for (const item of items) {
            console.log(`  - Item: type=${item.type}, title=${item.title}, url=${item.html_url || item.url}, ext_url=${item.external_url}`);
          }
        }
      }
    }

    console.log('\n=== Checking External Tools ===');
    for (const t of tabs) {
      if (t.label && (t.label.includes('视频') || t.label.includes('录像') || t.label.toLowerCase().includes('video'))) {
        console.log(`Inspecting tab [${t.label}]: ${t.html_url}`);
        const tabUrl = t.html_url.startsWith('http') ? t.html_url : `https://oc.sjtu.edu.cn${t.html_url}`;
        const resp = await ses.fetch(tabUrl);
        console.log(`Fetch status for ${t.label}: ${resp.status}`);
        const text = await resp.text();
        console.log(`HTML length: ${text.length}`);
        const formMatch = text.match(/<form[^>]*id=["']tool_form["'][^>]*action=["']([^"']+)["'][^>]*>/i);
        if (formMatch) {
          console.log(`  Found tool_form action: ${formMatch[1]}`);
        }
        const iframeMatch = text.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/gi);
        if (iframeMatch) {
          console.log(`  Found iframes:`, iframeMatch);
        }
      }
    }

  } catch (err) {
    console.error('Error during check:', err);
  } finally {
    app.quit();
  }
});
