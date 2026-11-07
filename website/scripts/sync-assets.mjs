import fs from 'node:fs/promises'
const source=new URL('../../docs/images/',import.meta.url)
const target=new URL('../public/screenshots/',import.meta.url)
for(const platform of ['desktop','android']){
 await fs.mkdir(new URL(platform+'/',target),{recursive:true})
 await fs.cp(new URL(platform+'/',source),new URL(platform+'/',target),{recursive:true})
}

await fs.copyFile(new URL('../../build/icon.png',import.meta.url),new URL('../public/app-icon.png',import.meta.url))
