// src/chart.js
// Canvas-based ECG renderer: green grid, scanning beam, glowing tips, responsive.
// Public API:
//   initECG(canvasId?: string)               -> initialize once
//   setDatasets(newDatasets: Array<{ username, data, color? }>) -> update users/data

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

// Map contributions -> waveform params (you可調整係數)
function computeParams(series) {
  // 平均值避免日際抖動
  const avg = (series && series.length)
    ? series.reduce((a,b) => a + b, 0) / series.length
    : 0;

  // 強度：0~3 範圍
  const intensity = Math.min(avg / 2, 3);        // commit 多 → 振幅大
  const speed = Math.max(80, 400 - avg * 10);     // commit 多 → 心跳快（週期短）
  return { intensity, speed };
}

// 心電圖樣式：簡化 QRS 複合波
function heartbeatPattern(t, intensity = 1, speed = 200) {
  const scale = 50 * intensity;
  const phase = t % speed;
  if (phase < 10)  return -0.8 * scale;  // Q
  if (phase < 20)  return  1.2 * scale;  // R
  if (phase < 30)  return -0.4 * scale;  // S
  // baseline + 微雜訊
  return (Math.random() - 0.5) * 0.1 * scale;
}

// 綠色網格
function drawGrid() {
  ctx.strokeStyle = "rgba(0,255,0,0.35)";
  ctx.lineWidth = 1;
  const grid = Math.max(20, Math.floor(width / 40)); // 自適應格距
  for (let i = 0; i <= width; i += grid) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, height);
    ctx.stroke();
  }
  for (let j = 0; j <= height; j += grid) {
    ctx.beginPath();
    ctx.moveTo(0, j);
    ctx.lineTo(width, j);
    ctx.stroke();
  }
}

// 主渲染
function render() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  drawGrid();

  datasets.forEach((d, idx) => {
    const { intensity, speed } = computeParams(d.data || []);
    const color = d.color || pickColor(idx);
    const yOffset = idx * Math.max(40, Math.round(height * 0.08)); // 垂直錯層

    if (!pointsPerUser[d.username]) pointsPerUser[d.username] = [];
    const points = pointsPerUser[d.username];

    // 推入新點，維持寬度長度
    points.push(mid + heartbeatPattern(xTick, intensity, speed) - yOffset);
    if (points.length > width) points.shift();

    // 畫線
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(0, points[0]);
      else ctx.lineTo(i, points[i]);
    }
    ctx.stroke();

    // 末端發光點
    const glowX = points.length - 1;
    const glowY = points[glowX];
    ctx.beginPath();
    ctx.arc(glowX, glowY, 6, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // 掃描線（向右掃過去的綠色光條）
  const scanX = (xTick % width);
  const beamWidth = Math.max(60, Math.round(width * 0.08));
  const gradient = ctx.createLinearGradient(scanX - beamWidth, 0, scanX, 0);
  gradient.addColorStop(0, "rgba(0,255,0,0)");
  gradient.addColorStop(1, "rgba(0,255,0,0.25)");
  ctx.fillStyle = gradient;
  ctx.fillRect(scanX - beamWidth, 0, beamWidth, height);

  xTick++;
  rafId = requestAnimationFrame(render);
}

// ---------- Public API ----------
export function initECG(canvasId = "ecgChart") {
  canvas = document.getElementById(canvasId);
  if (!canvas) {
    throw new Error(`ECG: canvas element #${canvasId} not found`);
  }
  ctx = canvas.getContext("2d");

  // 初次尺寸設定 + 監聽
  function resize() {
    // 使用 CSS 尺寸作為目標，避免縮放模糊
    const w = Math.floor(canvas.clientWidth);
    const h = Math.floor(canvas.clientHeight);
    if (w !== width || h !== height) {
      width = canvas.width = Math.max(300, w);
      height = canvas.height = Math.max(200, h);
      mid = Math.round(height / 2);
      // 尺寸改變時，重置歷史點避免鋸齒/拉伸
      pointsPerUser = {};
    }
  }

  resize();
  window.addEventListener("resize", resize);

  // 針對容器變化更精準的監聽
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  }

  // 啟動渲染
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(render);
}

export function setDatasets(newDatasets) {
  // newDatasets: [{ username, data:[numbers], color? }]
  datasets = (newDatasets || []).map((d, i) => ({
    username: d.username,
    data: Array.isArray(d.data) ? d.data : [],
    color: pickColor(i, d.color)
  }));
  // 清理舊的 points 以免殘影
  pointsPerUser = {};
}
