import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://sjtu.hisunalan.me',
  integrations: [tailwind({ applyBaseStyles: false })]
});
