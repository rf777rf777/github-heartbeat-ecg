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
  return (arr && arr.length) ? arr.reduce((a,b)=>a+b,0) / arr.length : 0;
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
  const QRS_WIDTH  = 0.06;   // 尖峰寬度（越小越尖）
  const QRS_LEFT   = QRS_CENTER - QRS_WIDTH * 0.5;
  const QRS_RIGHT  = QRS_CENTER + QRS_WIDTH * 0.5;

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
  const trackH  = Math.max(50, Math.floor(usableH / tracks));

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
  const plotW  = Math.max(60, width - LEFT_PAD - RIGHT_PAD);

  datasets.forEach((d, idx) => {
    const { intensity, speed } = computeParams(d.data || []);
    const color = d.color || pickColor(idx);

    const trackTop = TOP_PAD + idx * trackH;
    const trackMid = trackTop + Math.floor(trackH / 2);

    // 依軌道高度限制振幅（最多佔 45% 軌道高）
    const expectedScale = AMP_BASE * Math.max(0.001, intensity);
    const maxAmplitude  = trackH * 0.45;
    const scaleFactor   = Math.min(1, maxAmplitude / expectedScale);

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

  // === 掃描線（全軌道覆蓋，速度可調）===
  const scanRelX = (Math.floor(xTick * SCAN_SPEED_MULT) % plotW);
  const scanX = plotX0 + scanRelX;
  const beamWidth = Math.max(60, Math.round(width * BEAM_WIDTH_FRAC));
  const leftEdge = Math.max(plotX0, scanX - beamWidth);
  const grad = ctx.createLinearGradient(leftEdge, 0, scanX, 0);
  grad.addColorStop(0, "rgba(0,255,0,0)");
  grad.addColorStop(1, `rgba(0,255,0,${BEAM_OPACITY})`);
  ctx.fillStyle = grad;
  const minTrackTop = TOP_PAD;
  const maxTrackBot = TOP_PAD + tracks * trackH;
  ctx.fillRect(leftEdge, minTrackTop, scanX - leftEdge, maxTrackBot - minTrackTop);

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
 * 將目前 ECG 畫面錄成 GIF 檔（同源 worker，避免跨源安全性錯誤）
 * @param {Object} opts
 * @param {number} opts.seconds
 * @param {number} opts.fps
 * @param {number} opts.quality  // 數字越小 → 畫質好、檔案大
 * @returns {Promise<Blob>}
 */
export function exportECGAsGIF({ seconds = 5, fps = 30, quality = 10 } = {}) {
  return new Promise((resolve, reject) => {
    if (!canvas || !window.GIF) {
      return reject(new Error("GIF exporter not available. Make sure gif.js is loaded."));
    }
    const gif = new window.GIF({
      workers: 2,
      quality,
      width: canvas.width,
      height: canvas.height,
      // ▲▲▲ 使用同源 worker，修正你的安全性錯誤 ▲▲▲
      workerScript: "./assets/gif.worker.js",
      repeat: 0
    });

    const totalFrames = Math.max(1, Math.floor(seconds * fps));
    let captured = 0;

    const captureFrame = () => {
      gif.addFrame(canvas, { copy: true, delay: Math.round(1000 / fps) });
      captured++;
      if (captured < totalFrames) {
        requestAnimationFrame(captureFrame);
      } else {
        gif.on("finished", (blob) => resolve(blob));
        gif.on("abort", () => reject(new Error("GIF rendering aborted")));
        gif.on("error", (e) => reject(e));
        gif.render();
      }
    };

    requestAnimationFrame(captureFrame);
  });
}
