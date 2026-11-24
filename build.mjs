import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const files = [
  ['/','text/html; charset=utf-8',['client/index.html']],
  ['/style.css','text/css; charset=utf-8',['client/style.css']],
  ['/app.js','text/javascript; charset=utf-8',['client/core.js','client/drafts.js','client/reservations.js','client/workflow-views.js','client/app.js']]
];
export async function build(target = new URL('./dist/',import.meta.url)) {
  const out=new URL('server/',target);
  await mkdir(out,{recursive:true});
  await cp(new URL('./server/',import.meta.url),out,{recursive:true});
  await mkdir(new URL('.openai/',target),{recursive:true});
  await cp(new URL('./.openai/hosting.json',import.meta.url),new URL('.openai/hosting.json',target));
  const assets=Object.fromEntries(await Promise.all(files.map(async ([path,type,sources])=>[
    path,[type,(await Promise.all(sources.map(file=>readFile(new URL(file,import.meta.url),'utf8')))).join('\n')]
  ])));
  await writeFile(new URL('assets.js',out),'export default '+JSON.stringify(assets)+';\n');
  return new URL('index.js',out);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  await build();
  console.log('BSR Worker build complete');
}
