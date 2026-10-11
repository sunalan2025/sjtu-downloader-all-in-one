// ESLint flat config
// 本批目标：立护栏而非追求零警告。先让现有代码能过，后续批次逐步收紧。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  // 产物 / 配置 / 脚本 / 测试产物：不 lint
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'release/**',
      'build/icons/**',
      'scripts/**',
      '**/*.config.{js,mjs,ts,cjs}',
      'src/**/*.test.ts',
      'test/**',
      'src/test/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    // React Hooks 规则（代码里已有 // eslint-disable react-hooks/exhaustive-deps 注释，需插件支持）
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      // 现有代码大量 _ 前缀忽略参数 / catch 占位
      '@typescript-eslint/no-unused-vars': [
        'error', // 升为 error：严格阻断未使用的变量与类型导入
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      // 项目无 any 滥用，但偶有 unknown 收敛需求，先关掉避免阻塞
      '@typescript-eslint/no-explicit-any': 'off',
      // 大量 catch { /* ignore */ } 与空函数（销毁句柄占位）
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      // ffmpeg-static 用 require() 拿二进制路径（electron 项目常见模式）
      '@typescript-eslint/no-require-imports': 'off',
      // CanvasBrowser 有 cond && fn() 短路表达式
      '@typescript-eslint/no-unused-expressions': 'off',
      // 文件名清洗需 [\x00-\x1f] 控制字符正则
      'no-control-regex': 'off',
      // 项目风格不强制 catch 附加 cause / 不强制删无用赋值
      'preserve-caught-error': 'off',
      '@typescript-eslint/preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 严格检查 const 规范，升为 error 阻断
      'prefer-const': 'error'
    }
  }
)
