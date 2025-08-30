// src/chart.js
// Canvas-based ECG renderer with green grid, scanning beam, glowing tips, and on-canvas diagnoses.
// Public API:
//   initECG(canvasId?: string)
//   setDatasets(newDatasets: Array<{ username, data:number[], color?:string }>)
//   exportECGAsGIF({ seconds=5, fps=30, quality=10 } = {}): Promise<Blob>

// ======= Tunable ECG constants =======
const GRID_TARGET_COLUMNS = 40;     // 網格欄數（寬度自動分割）
const AMP_BASE = 50;                // 基礎振幅像素
const MAX_INTENSITY = 3;            // 振幅上限倍率
const INTENSITY_PER_AVG = 0.5;      // 平均 commit → 振幅映射係數
const SPEED_BASE = 400;             // 週期基準（越大越慢）
const SPEED_SLOPE = 10;             // 平均 commit → 週期縮短的係數（越大越快）
const MIN_SPEED = 80;               // 週期最小值
const BEAM_OPACITY = 0.25;          // 掃描光透明度
const BEAM_WIDTH_FRAC = 0.08;       // 掃描光寬度（占畫面寬度比例）
const DIAG_FONT = "14px monospace"; // 診斷文字字型
const DIAG_COLOR = "rgba(0,255,0,0.9)";
const DIAG_SHADOW = 8;              // 診斷文字光暈
const GLOW_RADIUS = 6;              // 末端發光點半徑
const RIGHT_SAFE_PAD = GLOW_RADIUS + 4; // 右側安全邊界，避免畫半顆圓
const SCAN_SPEED_MULT = 1;  // 掃描光速度倍數（1 = 原速，數字越大越快）
const SCAN_SPEED_PX_PER_FRAME = 3; // 掃描光每幀走幾像素（想快就調大）
let scanOffset = 0;                // 掃描光目前位移（相對於波形區）

// =====================================

let canvas, ctx;
let width = 0, height = 0, mid = 0;
let xTick = 0;
let rafId = null;
let pointsPerUser = {};
let datasets = []; // [{ username, data:[numbers], color }]
let resizeObserver = null;

const DEFAULT_COLORS = ["lime", "cyan", "yellow", "magenta", "orange", "deepskyblue", "springgreen", "gold"];

// ---------- Utils ----------
function pickColor(i, override) {
  if (override) return override;
  return DEFAULT_COLORS[i % DEFAULT_COLORS.length];
}

function avgOf(arr) {
  return (arr && arr.length) ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// 將 commit 序列映射成心跳參數
function computeParams(series) {
  const avg = avgOf(series);
  const intensity = Math.min(avg * INTENSITY_PER_AVG, MAX_INTENSITY);
  const speed = Math.max(MIN_SPEED, SPEED_BASE - avg * SPEED_SLOPE);
  return { intensity, speed, avg };
}

function heartbeatPattern(t, intensity = 1, speed = 200) {
  // 讓 QRS 成為明顯尖刺（三角形），其餘時間為微小噪聲
  const scale = AMP_BASE * intensity;

  // 週期內的位置（0 ~ 1）
  const phase = (t % speed) / speed;

  // 可調參數：尖峰位置與寬度（占整個週期的比例）
  const QRS_CENTER = 0.82;   // 尖峰中心的相對位置（0~1），你可以微調
  const QRS_WIDTH = 0.06;   // 尖峰寬度（越小越尖）
  const QRS_LEFT = QRS_CENTER - QRS_WIDTH * 0.5;
  const QRS_RIGHT = QRS_CENTER + QRS_WIDTH * 0.5;

  // 三角形尖峰：從左線性上升，到中心最高，再線性下降
  if (phase >= QRS_LEFT && phase <= QRS_RIGHT) {
    const half = (QRS_LEFT + QRS_RIGHT) / 2;
    const dist = Math.abs(phase - half) / (QRS_WIDTH * 0.5); // 0 at center, 1 at edges
    const peak = 1 - dist; // 三角形 from 0→1→0
    // 先快速下刺(Q)再高尖(R)再快速下刺(S)的「視覺」：用正負混合
    // 你可以調下面兩個係數來改Q與S的深度
    const Q_DEPTH = -0.55; // Q 向下
    const R_HEIGHT = 1.6;  // R 向上（越大越尖越高）
    const S_DEPTH = -0.45; // S 向下

    // 用 piecewise 讓左半段略偏負、中心高正、右半段略偏負，視覺近似QRS
    if (phase < half) {
      // 左半：由 Q_DEPTH 漸升至 R_HEIGHT
      const blend = peak; // 0→1
      const val = Q_DEPTH * (1 - blend) + R_HEIGHT * blend;
      return val * scale;
    } else {
      // 右半：由 R_HEIGHT 漸降至 S_DEPTH
      const blend = peak; // 1→0（因為 dist 變大）
      const val = S_DEPTH * (1 - blend) + R_HEIGHT * blend;
      return val * scale;
    }
  }

  // 其它時間：baseline + 輕微抖動，避免完全筆直
  const NOISE = 0.05 * scale; // 噪聲幅度
  return (Math.random() - 0.5) * 2 * NOISE;
}


// 綠色網格
function drawGrid() {
  ctx.strokeStyle = "rgba(0,255,0,0.35)";
  ctx.lineWidth = 1;
  const grid = Math.max(20, Math.floor(width / GRID_TARGET_COLUMNS));
  for (let i = 0; i <= width; i += grid) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke();
  }
  for (let j = 0; j <= height; j += grid) {
    ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(width, j); ctx.stroke();
  }
}

// 將診斷（文字）畫進 Canvas，並回傳面板寬與高，供版面配置用
function drawDiagnosesOnCanvas() {
  ctx.save();
  ctx.font = DIAG_FONT;

  const padX = 10;
  const padY = 10;
  const lineH = 18;

  // 先算每行文字與最大寬，文字顏色=對應線段顏色
  const rows = [];
  rows.push({ text: "Status:", color: "rgba(0,255,0,0.9)" }); // 標題固定綠
  datasets.forEach((d, i) => {
    const avg = avgOf(d.data);
    const status = (avg === 0) ? "💀 No activity"
      : (avg < 1) ? "⚠️ Low"
        : (avg < 3) ? "💚 Healthy"
          : "🔥 Monster";
    const text = `${d.username}: ${status} (avg ${avg.toFixed(2)})`;
    rows.push({ text, color: d.color || pickColor(i) });
  });

  let maxW = 0;
  rows.forEach(r => {
    const w = ctx.measureText(r.text).width;
    if (w > maxW) maxW = w;
  });

  const panelW = Math.ceil(maxW + padX * 2);
  const panelH = Math.ceil(rows.length * lineH + padY * 2);

  // 半透明底板，確保線永遠不會顯示在面板底下
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, panelW, panelH);

  // 逐行描繪，顏色對應各自線段
  ctx.shadowColor = "lime";
  ctx.shadowBlur = DIAG_SHADOW;

  let y = padY + 12;
  rows.forEach((r, idx) => {
    ctx.fillStyle = idx === 0 ? DIAG_COLOR : r.color; // 第一行為標題
    ctx.fillText(r.text, padX, y);
    y += lineH;
  });

  ctx.restore();
  return { panelW, panelH, lineH };
}


// 主渲染
function render() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  drawGrid();

  // === 軌道與版面 ===
  const TOP_PAD = 10;
  const LEFT_PAD = 10;
  const RIGHT_PAD = RIGHT_SAFE_PAD; // 右側為確保圓點完整預留
  const BOTTOM_PAD = 10;

  const tracks = Math.max(1, datasets.length);
  const usableH = height - TOP_PAD - BOTTOM_PAD;
  const trackH = Math.max(50, Math.floor(usableH / tracks));

  // 工具：確保每條軌道的點列一開始就填滿整個可畫寬度，避免左側空白
  function ensureFilled(points, widthNeeded, baselineY) {
    if (points.length < widthNeeded) {
      const pad = widthNeeded - points.length;
      points.unshift(...new Array(pad).fill(baselineY));
    } else if (points.length > widthNeeded) {
      points.splice(0, points.length - widthNeeded);
    }
  }

  // === 先把所有波形畫滿整個寬度（從最左邊開始）===
  const plotX0 = LEFT_PAD;
  const plotW = Math.max(60, width - LEFT_PAD - RIGHT_PAD);

  datasets.forEach((d, idx) => {
    const { intensity, speed } = computeParams(d.data || []);
    const color = d.color || pickColor(idx);

    const trackTop = TOP_PAD + idx * trackH;
    const trackMid = trackTop + Math.floor(trackH / 2);

    // 依軌道高度限制振幅（最多佔 45% 軌道高）
    const expectedScale = AMP_BASE * Math.max(0.001, intensity);
    const maxAmplitude = trackH * 0.45;
    const scaleFactor = Math.min(1, maxAmplitude / expectedScale);

    if (!pointsPerUser[d.username]) pointsPerUser[d.username] = [];
    const points = pointsPerUser[d.username];

    // 先填滿以避免左側空白
    ensureFilled(points, plotW, trackMid);

    // 推入新點、維持固定長度
    let yVal = heartbeatPattern(xTick, intensity, speed) * scaleFactor;
    points.push(trackMid + yVal);
    points.shift(); // 固定長度 = plotW

    // 畫線（從最左邊開始）
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < points.length; i++) {
      const x = plotX0 + i;
      const y = points[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 末端發光點（完整圓，不被裁切）
    const glowX = plotX0 + points.length - 1;
    const glowY = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(glowX, glowY, GLOW_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // —— 掃描光 ——
  // 相對位移（0..plotW-1）
  const relX = scanOffset % plotW;
  const scanX = plotX0 + relX;

  const beamWidth = Math.max(60, Math.round(width * BEAM_WIDTH_FRAC));
  const leftEdge = Math.max(plotX0, scanX - beamWidth);

  const grad = ctx.createLinearGradient(leftEdge, 0, scanX, 0);
  grad.addColorStop(0, "rgba(0,255,0,0)");
  grad.addColorStop(1, `rgba(0,255,0,${BEAM_OPACITY})`);
  ctx.fillStyle = grad;
  const minTrackTop = TOP_PAD;
  const maxTrackBot = TOP_PAD + tracks * trackH;
  ctx.fillRect(leftEdge, minTrackTop, scanX - leftEdge, maxTrackBot - minTrackTop);

  // 每幀固定前進
  scanOffset = (scanOffset + SCAN_SPEED_PX_PER_FRAME) % plotW;

  // === 最後再畫「左上診斷面板」蓋上去（看起來不重疊、也不留空白）===
  drawDiagnosesOnCanvas();

  // 在尖峰區域加速取樣，讓上升/下降更陡峭
  const phase = (xTick % 200) / 200; // 這個 "200" 要與你傳給 heartbeatPattern 的 speed 對齊
  const inQRS = phase >= 0.82 - 0.03 && phase <= 0.82 + 0.03; // 與上面 QRS_CENTER/ WIDTH 對齊
  xTick += inQRS ? 2 : 1; // 尖峰區多走幾步 → 更「銳」

  rafId = requestAnimationFrame(render);
}




// ---------- Public API ----------
export function initECG(canvasId = "ecgChart") {
  canvas = document.getElementById(canvasId);
  if (!canvas) throw new Error(`ECG: canvas element #${canvasId} not found`);
  ctx = canvas.getContext("2d");

  function resize() {
    const w = Math.floor(canvas.clientWidth);
    const h = Math.floor(canvas.clientHeight);
    if (w !== width || h !== height) {
      width = canvas.width = Math.max(300, w);
      height = canvas.height = Math.max(200, h);
      mid = Math.round(height / 2);
      // 尺寸改變時重置歷史點，避免拉伸殘影
      pointsPerUser = {};
    }
    scanOffset = 0;
  }
  resize();
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  }

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(render);
}

export function setDatasets(newDatasets) {
  datasets = (newDatasets || []).map((d, i) => ({
    username: d.username,
    data: Array.isArray(d.data) ? d.data : [],
    color: pickColor(i, d.color)
  }));
  pointsPerUser = {}; // 清理舊點
}

/**
 * 錄製目前 ECG 畫面為 GIF（等比縮放 + 可加邊，避免裁切；fps 節流）
 * @param {Object} opts
 * @param {number} opts.seconds        錄製秒數
 * @param {number} opts.fps            目標幀率（建議 10–15）
 * @param {number} opts.quality        gif.js 取樣品質（數字越大 → 檔案更小；預設 10）
 * @param {number} opts.maxWidth       目標最大寬
 * @param {number} opts.maxHeight      目標最大高
 * @param {string} opts.background     contain 時的邊框色
 * @param {boolean} opts.contain       true=保比例加邊；false=等比縮至不超過（無固定框）
 * @param {boolean|string} opts.dither 抖動：true/'FloydSteinberg'/'Atkinson'/false
 * @returns {Promise<Blob>}
 */
export function exportECGAsGIF({
  seconds = 30,
  fps = 12,
  quality = 8,
  maxWidth = 1080,
  maxHeight = 1080,
  background = '#000',
  contain = false,
  dither = 'FloydSteinberg'
} = {}) {
  return new Promise((resolve, reject) => {
    if (!canvas || !window.GIF) {
      return reject(new Error("GIF exporter not available. Make sure gif.js is loaded."));
    }

    // ── 設定等比縮放（不裁切） ───────────────────────────────
    const srcW = canvas.width;
    const srcH = canvas.height;
    const scale = Math.min(maxWidth / srcW, maxHeight / srcH, 1); // 不放大
    const drawW = Math.round(srcW * scale);
    const drawH = Math.round(srcH * scale);

    // offscreen: 依 contain 決定輸出畫布大小（含邊）或剛好大小（無邊）
    const outW = contain ? maxWidth : drawW;
    const outH = contain ? maxHeight : drawH;

    const off = document.createElement('canvas');
    off.width = outW;
    off.height = outH;
    const ctx = off.getContext('2d', { willReadFrequently: true });

    const dx = Math.floor((outW - drawW) / 2);
    const dy = Math.floor((outH - drawH) / 2);

    // 預繪一張 frame 的函式
    const blit = () => {
      if (contain) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, outW, outH);
      }
      // 把當前主畫布畫到 offscreen（等比不裁切）
      ctx.drawImage(canvas, 0, 0, srcW, srcH, dx, dy, drawW, drawH);
    };

    // ── 初始化 GIF 寫手 ─────────────────────────────────
    const gif = new window.GIF({
      workers: 2,
      quality,           // gif.js: 1=最佳(大/慢)；10=較差(小/快)
      width: outW,
      height: outH,
      workerScript: "./assets/gif.worker.js",
      repeat: 0,
      dither             // 可為 false / true / 'FloydSteinberg' / 'Atkinson'
    });

    const totalFrames = Math.max(1, Math.floor(seconds * fps));
    let captured = 0;

    // ── fps 節流：用 rAF 但只在達到 (1000/fps) ms 時抓一格 ──
    const frameDelayMs = 1000 / fps;
    let last = performance.now();

    const step = (now) => {
      if (captured >= totalFrames) {
        gif.on("finished", (blob) => resolve(blob));
        gif.on("abort", () => reject(new Error("GIF rendering aborted")));
        gif.on("error", (e) => reject(e));
        return gif.render();
      }

      if (now - last >= frameDelayMs) {
        last = now;
        blit();
        gif.addFrame(off, { copy: true, delay: Math.round(frameDelayMs) });
        captured++;
      }
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  });
}

/**
 * 為 Node.js 環境生成 ECG GIF（不依賴 gif.worker.js）
 * 這個函數需要 canvas 和 gifencoder 套件，專為 GitHub Actions 設計
 * @param {Object} opts
 * @param {number} opts.seconds        錄製秒數
 * @param {number} opts.fps            目標幀率
 * @param {number} opts.quality        GIF 品質 (1-20，數字越小品質越好)
 * @param {number} opts.width          輸出寬度
 * @param {number} opts.height         輸出高度
 * @param {string} opts.outputPath     輸出檔案路徑
 * @returns {Promise<string>}          返回生成的檔案路徑
 */
export async function exportECGAsGIFForNode({
  seconds = 20,
  fps = 12,
  quality = 10,
  width: outputWidth = 1200,
  height: outputHeight = 800,
  outputPath = './ecg-output.gif'
} = {}) {
  // 檢查是否在 Node.js 環境中
  if (typeof window !== 'undefined') {
    throw new Error('exportECGAsGIFForNode is designed for Node.js environment only');
  }
  console.log(this.datasets)
  try {
    // 動態引入 Node.js 專用套件
    const { createCanvas } = await import('canvas');
    const GIFEncoder = await import('gifencoder');
    const fs = await import('fs');

    // 建立 Node.js Canvas
    const nodeCanvas = createCanvas(outputWidth, outputHeight);
    const nodeCtx = nodeCanvas.getContext('2d');

    // 建立 GIF 編碼器
    const encoder = new GIFEncoder.default(outputWidth, outputHeight);
    const stream = encoder.createReadStream();

    // 設定 GIF 參數
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(Math.round(1000 / fps));
    encoder.setQuality(quality);

    const totalFrames = Math.max(1, Math.floor(seconds * fps));
    let frameCount = 0;

    console.log(`Generating ${totalFrames} frames for ${seconds}s GIF at ${fps} FPS...`);

    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(outputPath);
      stream.pipe(writeStream);

      writeStream.on('finish', () => {
        console.log(`GIF saved to: ${outputPath}`);
        resolve(outputPath);
      });

      writeStream.on('error', reject);

      // 模擬 ECG 渲染邏輯
      const renderFrame = () => {
        if (frameCount >= totalFrames) {
          encoder.finish();
          return;
        }

        // 清空畫面
        nodeCtx.fillStyle = "black";
        nodeCtx.fillRect(0, 0, outputWidth, outputHeight);

        // 畫網格
        nodeCtx.strokeStyle = "rgba(0,255,0,0.35)";
        nodeCtx.lineWidth = 1;
        const grid = Math.max(20, Math.floor(outputWidth / GRID_TARGET_COLUMNS));
        for (let i = 0; i <= outputWidth; i += grid) {
          nodeCtx.beginPath();
          nodeCtx.moveTo(i, 0);
          nodeCtx.lineTo(i, outputHeight);
          nodeCtx.stroke();
        }
        for (let j = 0; j <= outputHeight; j += grid) {
          nodeCtx.beginPath();
          nodeCtx.moveTo(0, j);
          nodeCtx.lineTo(outputWidth, j);
          nodeCtx.stroke();
        }

        // 畫 ECG 波形
        const TOP_PAD = 10;
        const LEFT_PAD = 10;
        const RIGHT_PAD = RIGHT_SAFE_PAD;
        const BOTTOM_PAD = 10;

        const tracks = Math.max(1, datasets.length);
        const usableH = outputHeight - TOP_PAD - BOTTOM_PAD;
        const trackH = Math.max(50, Math.floor(usableH / tracks));
        const plotX0 = LEFT_PAD;
        const plotW = Math.max(60, outputWidth - LEFT_PAD - RIGHT_PAD);

        this.datasets.forEach((d, idx) => {
          const { intensity, speed } = computeParams(d.data || []);
          const color = d.color || pickColor(idx);

          const trackTop = TOP_PAD + idx * trackH;
          const trackMid = trackTop + Math.floor(trackH / 2);

          const expectedScale = AMP_BASE * Math.max(0.001, intensity);
          const maxAmplitude = trackH * 0.45;
          const scaleFactor = Math.min(1, maxAmplitude / expectedScale);

          if (!pointsPerUser[d.username]) pointsPerUser[d.username] = [];
          const points = pointsPerUser[d.username];

          // 確保填滿
          if (points.length < plotW) {
            const pad = plotW - points.length;
            points.unshift(...new Array(pad).fill(trackMid));
          } else if (points.length > plotW) {
            points.splice(0, points.length - plotW);
          }

          // 新增點
          let yVal = heartbeatPattern(xTick, intensity, speed) * scaleFactor;
          points.push(trackMid + yVal);
          points.shift();

          // 畫線
          nodeCtx.beginPath();
          nodeCtx.strokeStyle = color;
          nodeCtx.lineWidth = 2;
          for (let i = 0; i < points.length; i++) {
            const x = plotX0 + i;
            const y = points[i];
            if (i === 0) nodeCtx.moveTo(x, y);
            else nodeCtx.lineTo(x, y);
          }
          nodeCtx.stroke();

          // 發光點
          const glowX = plotX0 + points.length - 1;
          const glowY = points[points.length - 1];
          nodeCtx.beginPath();
          nodeCtx.arc(glowX, glowY, GLOW_RADIUS, 0, 2 * Math.PI);
          nodeCtx.fillStyle = color;
          nodeCtx.shadowColor = color;
          nodeCtx.shadowBlur = 20;
          nodeCtx.fill();
          nodeCtx.shadowBlur = 0;
        });

        // 掃描光
        const relX = scanOffset % plotW;
        const scanX = plotX0 + relX;
        const beamWidth = Math.max(60, Math.round(outputWidth * BEAM_WIDTH_FRAC));
        const leftEdge = Math.max(plotX0, scanX - beamWidth);

        const grad = nodeCtx.createLinearGradient(leftEdge, 0, scanX, 0);
        grad.addColorStop(0, "rgba(0,255,0,0)");
        grad.addColorStop(1, `rgba(0,255,0,${BEAM_OPACITY})`);
        nodeCtx.fillStyle = grad;
        const minTrackTop = TOP_PAD;
        const maxTrackBot = TOP_PAD + tracks * trackH;
        nodeCtx.fillRect(leftEdge, minTrackTop, scanX - leftEdge, maxTrackBot - minTrackTop);

        scanOffset = (scanOffset + SCAN_SPEED_PX_PER_FRAME) % plotW;

        // 診斷面板
        nodeCtx.save();
        nodeCtx.font = DIAG_FONT;

        const padX = 10;
        const padY = 10;
        const lineH = 18;

        const rows = [];
        rows.push({ text: "Status:", color: "rgba(0,255,0,0.9)" });
        datasets.forEach((d, i) => {
          const avg = avgOf(d.data);
          const status = (avg === 0) ? "💀 No activity"
            : (avg < 1) ? "⚠️ Low"
              : (avg < 3) ? "💚 Healthy"
                : "🔥 Monster";
          const text = `${d.username}: ${status} (avg ${avg.toFixed(2)})`;
          rows.push({ text, color: d.color || pickColor(i) });
        });

        let maxW = 0;
        rows.forEach(r => {
          const w = nodeCtx.measureText(r.text).width;
          if (w > maxW) maxW = w;
        });

        const panelW = Math.ceil(maxW + padX * 2);
        const panelH = Math.ceil(rows.length * lineH + padY * 2);

        nodeCtx.fillStyle = "rgba(0,0,0,0.7)";
        nodeCtx.fillRect(0, 0, panelW, panelH);

        nodeCtx.shadowColor = "lime";
        nodeCtx.shadowBlur = DIAG_SHADOW;

        let y = padY + 12;
        rows.forEach((r, idx) => {
          nodeCtx.fillStyle = idx === 0 ? DIAG_COLOR : r.color;
          nodeCtx.fillText(r.text, padX, y);
          y += lineH;
        });

        nodeCtx.restore();

        // 更新動畫參數
        const phase = (xTick % 200) / 200;
        const inQRS = phase >= 0.82 - 0.03 && phase <= 0.82 + 0.03;
        xTick += inQRS ? 2 : 1;

        // 添加幀到 GIF
        encoder.addFrame(nodeCtx);
        frameCount++;

        if (frameCount % Math.floor(totalFrames / 10) === 0) {
          console.log(`Progress: ${Math.round((frameCount / totalFrames) * 100)}%`);
        }

        // 繼續下一幀
        setTimeout(renderFrame, Math.round(1000 / fps));
      };

      renderFrame();
    });

  } catch (error) {
    console.error('Error in exportECGAsGIFForNode:', error);
    throw error;
  }
}

/**
 * Node.js 環境專用：創建 ECG 渲染器類別
 * 用於 GitHub Actions 或其他 Node.js 環境
 */
export class NodeECGRenderer {
  constructor(width = 800, height = 300) {
    if (typeof window !== 'undefined') {
      throw new Error('NodeECGRenderer is designed for Node.js environment only');
    }

    this.width = width;
    this.height = height;
    this.mid = Math.round(height / 2);
    this.xTick = 0;
    this.scanOffset = 0;
    this.pointsPerUser = {};
    this.datasets = [];
  }
  setDatasets(newDatasets) {
    console.log(newDatasets)

    this.datasets = (newDatasets || []).map((d, i) => ({
      username: d.username,
      data: Array.isArray(d.data) ? d.data : [],
      color: pickColor(i, d.color)
    }));
    this.pointsPerUser = {};
  }

  async generateGIF(outputPath = './ecg-output.gif', options = {}) {
    const {
      seconds = 15,
      fps = 20,
      quality = 5
    } = options;

    return exportECGAsGIFForNode.call(this, {
      seconds,
      fps,
      quality,
      width: this.width,
      height: this.height,
      outputPath
    });
  }
}
