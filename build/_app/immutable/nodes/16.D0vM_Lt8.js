import{A as e,H as t,Nt as n,W as r,Z as i,_t as a,bt as o,ct as s,dt as c,ft as l,lt as u,pt as d,tt as f,vt as p,y as m}from"../chunks/vHPZcmWs.js";import"../chunks/S-KyrcF8.js";import{t as h}from"../chunks/CZkvMPiy.js";var g=r(`<h1>Read only</h1> <p>Use JSONEditor in read-only mode, content in this example is supplied by a separate textarea:</p> <div><textarea style="width: 700px; height: 200px"></textarea></div> <div class="editor svelte-1x74df4"><!></div>`,1);function _(r){let _=p(`{
  "array": [1, 2, 3],
  "boolean": true,
  "color": "#82b92c",
  "null": null,
  "number": 123,
  "object": { "a": "b", "c": "d" },
  "string": "Hello World"
}`);var v=g();e(`1x74df4`,e=>{f(()=>{u.title=`Read only | svelte-jsoneditor`})});var y=d(l(v),4),b=c(y);s(b),n(y);var x=d(y,2),S=c(x);{let e=o(()=>({text:i(_)}));h(S,{get content(){return i(e)},readOnly:`true`,mode:`text`,maxDocumentSizeTextMode:10485760})}n(x),m(b,()=>i(_),e=>a(_,e)),t(r,v)}export{_ as component};