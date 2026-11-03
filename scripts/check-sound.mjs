/** Browser checks against real Web Audio output, media playback and modal input. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const executablePath = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => p && fs.existsSync(p));
if (!executablePath) throw new Error('Install Chrome/Edge or set CHROME_PATH.');
const browser = await puppeteer.launch({ executablePath, headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const base = process.argv[2] || 'http://127.0.0.1:5188/';
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inspect = () => page.evaluate(() => window.__konbini.sound.inspect());
const state = () => page.evaluate(() => window.__konbini.sound.getState());
const setSlider = (channel, value) => page.$eval(`[data-channel="${channel}"]`, (input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const check = (name, condition) => { assert.ok(condition, name); console.log('PASS ' + name); };
const fixture = path.join(os.tmpdir(), `hoshino-sound-${process.pid}.wav`);
// A short generated sine is solely a test fixture, never shipped as the requested song.
const samples = 22050 * 2;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 22050) * 8000), 44 + i * 2);
fs.writeFileSync(fixture, wav);

try {
  await page.goto(base + '?instant=1&weather=clear', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!window.__konbini, { timeout: 90000 });
  check('No audio context or autoplay before a gesture', (await inspect()).context === 'uninitialized');
  await page.click('.sound-toggle');
  await page.waitForSelector('.sound-panel[open]');
  await page.waitForFunction(() => window.__konbini.sound.getState().ready);
  await sleep(500);
  check('Trusted button click starts real ambient output', (await inspect()).rms > 0.00001);
  const rect = await page.$eval('.sound-panel', (panel) => {
    const r = panel.getBoundingClientRect();
    return Math.abs(r.x + r.width / 2 - innerWidth / 2) < 1 && Math.abs(r.y + r.height / 2 - innerHeight / 2) < 1;
  });
  check('Sound panel opens in the center', rect);
  check('Bundled NIGHT DANCER is ready without selecting a file',
    !(await page.$eval('.sound-panel__play', (b) => b.disabled)) && (await state()).trackName === 'NIGHT DANCER · imase');
  check('Bundled music waits for an explicit play click', !(await state()).musicPlaying);
  await setSlider('ambience', 0);
  await setSlider('effects', 0);
  await page.click('.sound-panel__play');
  await page.waitForFunction(() => window.__konbini.sound.inspect().musicTime > 0.2, { timeout: 15000 });
  await page.waitForFunction(() => window.__konbini.sound.inspect().rms > 0.00001, { timeout: 10000 });
  check('Bundled MP3 decodes and reaches the real audio output', (await state()).musicPlaying && !(await state()).message);
  await page.click('.sound-panel__play');
  await setSlider('ambience', 60);
  await setSlider('effects', 65);
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  check('Keyboard focus remains inside the modal', await page.evaluate(() => !!document.activeElement.closest('.sound-panel')));
  const weather = await page.evaluate(() => window.__konbini.env.get());
  await page.focus('[data-channel="master"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('5');
  assert.deepEqual(await page.evaluate(() => window.__konbini.env.get()), weather);
  check('Modal sliders and shortcuts do not change scene weather', true);
  await setSlider('master', 42);
  await page.click('.sound-panel__mute');
  await sleep(500);
  check('Master mute silences actual graph output', (await inspect()).rms < 0.000001);
  await page.click('.sound-panel__mute');
  await sleep(300);
  check('Unmute restores ambient output', (await inspect()).rms > 0.00001);
  await page.evaluate(() => window.__konbini.env.set({ time: 'night', weather: 'rain' }));
  await page.waitForFunction(() => window.__konbini.sound.inspect().rain > 0.23);
  check('Rain and nighttime follow the environment', (await inspect()).environment.time === 'night');
  await page.evaluate(() => window.__konbini.env.set({ weather: 'snow' }));
  await page.waitForFunction(() => window.__konbini.sound.inspect().rain < 0.015 && window.__konbini.sound.inspect().wind > 0.2);
  check('Snow fades rain out and raises soft wind', true);

  await page.evaluate(() => {
    const k = window.__konbini;
    window.soundEvents = [];
    k.world.street.vending[0].onSound((event) => window.soundEvents.push(event.type));
    k.world.street.vending[0].purchase('water');
  });
  await page.waitForFunction(() => window.soundEvents.includes('impact'), { timeout: 10000 });
  check('Actual bottle dispensing and collisions emit sound', await page.evaluate(() => window.soundEvents.includes('purchase')));
  await page.evaluate(() => {
    const machine = window.__konbini.world.street.vending[0];
    const id = machine.getBottles()[0].id;
    machine.grabBottle(id);
    machine.releaseBottle(id, new window.__konbini.camera.position.constructor(), true);
  });
  check('Actual pickup and recycling emit their effects', await page.evaluate(() => window.soundEvents.includes('pickup') && window.soundEvents.includes('recycle')));

  await setSlider('ambience', 0);
  await setSlider('effects', 0);
  await (await page.$('.sound-panel__file')).uploadFile(fixture);
  await page.waitForFunction(() => window.__konbini.sound.getState().musicPlaying);
  await page.waitForFunction(() => window.__konbini.sound.inspect().musicTime > 0.15, { timeout: 10000 });
  check('Selected local audio plays through the music mixer', (await state()).trackLoaded && (await inspect()).rms > 0.001);
  await page.click('.sound-panel__play');
  const paused = (await inspect()).musicTime;
  await sleep(250);
  check('Pause preserves the track position', !(await state()).musicPlaying && Math.abs((await inspect()).musicTime - paused) < 0.05);
  await page.click('.sound-panel__play');
  await page.waitForFunction(() => window.__konbini.sound.getState().musicPlaying);
  await setSlider('music', 0);
  await sleep(350);
  check('Zero music volume pauses and silences music', !(await state()).musicPlaying && (await inspect()).rms < 0.000001);
  await setSlider('music', 35);
  await page.waitForFunction(() => window.__konbini.sound.getState().musicPlaying);
  await page.click('.sound-panel__mute');
  check('Mute also pauses music', !(await state()).musicPlaying);
  await page.click('.sound-panel__mute');
  await page.waitForFunction(() => window.__konbini.sound.getState().musicPlaying);

  const foreground = await browser.newPage();
  await foreground.bringToFront();
  await page.waitForFunction(() => document.hidden);
  await page.waitForFunction(() => window.__konbini.sound.inspect().context === 'suspended');
  check('Background tabs suspend audio and pause music', !(await state()).musicPlaying);
  await page.bringToFront();
  await foreground.close();
  await page.waitForFunction(() => window.__konbini.sound.getState().musicPlaying);
  check('Returning resumes the previously playing music', true);

  fs.mkdirSync('shots', { recursive: true });
  await page.screenshot({ path: 'shots/sound-panel-desktop.png' });
  for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
    await page.setViewport({ width, height });
    check(`Sound modal fits ${width}×${height}`, await page.$eval('.sound-panel', (panel) => {
      const r = panel.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && panel.scrollWidth <= panel.clientWidth;
    }));
    if (width === 390) await page.screenshot({ path: 'shots/sound-panel-mobile.png' });
  }
  await page.keyboard.press('Escape');
  check('Escape closes and restores button focus', await page.evaluate(() => !document.querySelector('dialog[open]') && document.activeElement.matches('.sound-toggle')));
  await page.click('.sound-toggle');
  await page.mouse.click(4, 4);
  check('Backdrop click dismisses the panel', !(await page.$('.sound-panel[open]')));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__konbini, { timeout: 90000 });
  check('Volumes survive reload without autoplay', (await state()).master === 0.42 && (await state()).ambience === 0 && (await inspect()).context === 'uninitialized');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('PASS No browser runtime errors');
} finally {
  await browser.close();
  fs.rmSync(fixture, { force: true });
}
