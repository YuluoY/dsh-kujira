import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarkdown} from '../lib/shared/task/markdown.js';
const React={Fragment:'fragment',useMemo:fn=>fn(),createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})};
const Markdown=createMarkdown(React);
const walk=node=>node&&typeof node==='object'?[node,...node.children.flatMap(walk)]:[];
const render=text=>walk(Markdown({text}));
test('renders headings, nested lists, code, blockquotes, tables and task checks',()=>{
 const nodes=render('# Summary\n\n**Done** and *tested*.\n\n- [x] Done\n  - nested\n\n> Note\n\n```js\nconst x = 1;\n```\n\n| File | State |\n| --- | --- |\n| a.js | OK |');
 for(const tag of ['h3','strong','em','ul','li','blockquote','pre','code','table','th','td','input'])assert(nodes.some(n=>n.type===tag),tag);
 assert(nodes.find(n=>n.type==='input').props.disabled);
});
test('untrusted markup cannot create executable HTML, scripts, images or unsafe links',()=>{
 const nodes=render('<script>alert(1)</script>\n\n[x](javascript:alert) [ok](https://example.com) ![image](https://example.com/tracker.png)');
 assert(!nodes.some(n=>['script','img','iframe'].includes(n.type)));
 assert(!nodes.some(n=>n.props.dangerouslySetInnerHTML));
 const links=nodes.filter(n=>n.type==='a');assert(links.every(n=>n.props.href.startsWith('https://')));
 assert(links.every(n=>n.props.rel==='noopener noreferrer'));
});
test('file links use host navigation and long or incomplete Markdown remains bounded',()=>{
 let path;
 const nodes=walk(Markdown({text:'[file](lib/index.js)',onOpenFile:value=>{path=value;}}));
 nodes.find(n=>n.type==='button').props.onClick();assert.equal(path,'lib/index.js');
 const output=render('```text\n'+'unbroken'.repeat(4000));assert(output.some(n=>n.type==='pre'));
 assert(output.find(n=>n.type==='code').children[0].length<=12000);
});

test('collapsed result preview excludes Markdown syntax and subsequent details',async()=>{
 const {markdownExcerpt}=await import('../lib/shared/task/markdown.js');
 assert.equal(markdownExcerpt('## Report\n\nCompleted **tests** with [details](https://example.com).\n\n- More details'), 'Completed tests with details.');
});
