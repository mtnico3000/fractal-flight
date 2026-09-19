// The GPU-class hint (v9.9).
//
// The start page warns when the WebGL context did NOT land on a discrete GPU,
// because that cliff is otherwise invisible: the adaptive scaler quietly drops
// the resolution and the game just looks softer. Measured on this project, the
// same code ran 1707x932 on the RTX and was pinned to the scaler's 683x359
// floor on the Intel iGPU.
//
// This is string classification, which is exactly the kind of code that looks
// right and is wrong. The first version shipped a literal BACKSPACE byte where
// a \b word boundary was meant, so every discrete GPU classified as "unknown"
// and the hint silently never fired for the case it exists to detect.
const { loadModule, check, eq, ok, summary } = require('./harness');

// renderer.js grabs a WebGL2 context at module scope; stub the DOM it needs.
const glStub = { getExtension: () => null, getParameter: () => null };
const R = loadModule('renderer.js', {
  vsSrc: '', fsSrc: '',
  document: { getElementById: () => ({ getContext: () => glStub, style: {}, classList: { add() {}, remove() {} } }) },
  window: { devicePixelRatio: 1, innerWidth: 800, innerHeight: 600, addEventListener() {} },
}, ['gpuClass', 'gpuRenderer', 'gpuShortName']);

const DISCRETE = [
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU (0x00002757) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'NVIDIA Quadro P2000/PCIe/SSE2',
  'Apple M2 Pro',
];
const INTEGRATED = [
  'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Intel(R) HD Graphics 4000',
  'Mali-G78',
  'Adreno (TM) 660',
];
const SOFTWARE = [
  'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Google SwiftShader',
  'llvmpipe (LLVM 15.0.6, 256 bits)',
];

check('a discrete GPU is recognised, so the hint stays quiet', () => {
  for (const n of DISCRETE) eq(R.gpuClass(n), 'discrete', n.slice(0, 46));
});

check('an integrated GPU is recognised, so the hint fires', () => {
  for (const n of INTEGRATED) eq(R.gpuClass(n), 'integrated', n.slice(0, 46));
});

check('a software rasteriser is recognised, and is NOT called integrated', () => {
  // WARP and SwiftShader both name a vendor, so an integrated-first test
  // claims them. That mislabels the worst case as merely mediocre.
  for (const n of SOFTWARE) eq(R.gpuClass(n), 'software', n.slice(0, 46));
});

check('an unknown or withheld renderer says nothing rather than guessing', () => {
  // WEBGL_debug_renderer_info is privacy-restricted in some browsers, and a
  // wrong guess would nag someone whose machine is already fine.
  for (const n of [null, undefined, '', 'Some Future GPU 9000']) eq(R.gpuClass(n), null, JSON.stringify(n));
});

check('the renderer name is shortened to something a human reads', () => {
  // ANGLE wraps names as  ANGLE (VENDOR, RENDERER DETAILS, BACKEND).  Trimming
  // naively at the first ')' gives "Intel, Intel(R" -- the vendor twice and
  // nothing useful -- which is what the first version showed on the start page.
  const cases = [
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
     'Intel(R) Iris(R) Xe Graphics'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU (0x00002757) Direct3D11 vs_5_0 ps_5_0, D3D11)',
     'NVIDIA GeForce RTX 4090 Laptop GPU'],
    ['ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)',
     'Microsoft Basic Render Driver'],
    ['Apple M2 Pro', 'Apple M2 Pro'],           // not ANGLE: passes through
    ['Google SwiftShader', 'Google SwiftShader'],
    ['', ''],
    [null, ''],
  ];
  for (const [inp, want] of cases) eq(R.gpuShortName(inp), want, JSON.stringify(inp));
  for (const [inp] of cases) {
    const out = R.gpuShortName(inp);
    ok(!/^ANGLE/.test(out), 'the ANGLE wrapper survived: ' + out);
    ok(out.indexOf(', ') === -1, 'a vendor/backend field leaked through: ' + out);
  }
});

check('the classifier carries no stray control bytes', () => {
  // A \b written through a code-generating patch can arrive as a literal
  // backspace (0x08). The regex then demands a control character before the
  // vendor name and matches nothing, which reads as "unknown" forever.
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'renderer.js'), 'utf8');
  const bad = [...src].findIndex(c => {
    const k = c.charCodeAt(0);
    return (k < 9) || (k > 10 && k < 13) || (k > 13 && k < 32);
  });
  ok(bad === -1, 'control byte 0x' + (bad === -1 ? '' : src.charCodeAt(bad).toString(16)) +
     ' at offset ' + bad + ' — a collapsed escape');
});

process.exitCode = summary('gpu') ? 1 : 0;
