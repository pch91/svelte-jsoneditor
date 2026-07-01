import{A as e,H as t,Nt as n,W as r,Z as i,_t as a,dt as o,ft as s,lt as c,mt as l,pt as u,tt as d,vt as f}from"../chunks/vHPZcmWs.js";import"../chunks/S-KyrcF8.js";import{t as p}from"../chunks/DTXECNhJ.js";import{n as m,t as h}from"../chunks/BvCQooIU.js";var g=r(`<h1>Custom JSON Parser (Lossless JSON)</h1> <p>Instead of using the native <code class="svelte-49ei4j">JSON</code> parser, you can configure a different parser like <a target="_blank" href="https://github.com/josdejong/lossless-json" rel="noreferrer">lossless-json</a> using the option <code class="svelte-49ei4j">parser</code> in order to be able to handle large numbers like <code class="svelte-49ei4j">long</code> values.</p> <div class="editor svelte-49ei4j"><!></div>`,1);function _(r){let _={parse:m,stringify:h},v=f(l({text:`{
  "using": "Lossless JSON Parser",
  "formatted number": 4.0,
  "long": 9123372036854000123,
  "large": 1e500,
  "small": 1e-500
}`,json:void 0}));var y=g();e(`49ei4j`,e=>{d(()=>{c.title=`Custom JSON Parser (Lossless JSON) | svelte-jsoneditor`})});var b=u(s(y),4);p(o(b),{get parser(){return _},get content(){return i(v)},set content(e){a(v,e,!0)}}),n(b),t(r,y)}export{_ as component};