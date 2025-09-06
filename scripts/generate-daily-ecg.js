#!/usr/bin/env node

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 與 chart.js 對齊的常數
const GRID_TARGET_COLUMNS = 40;
const AMP_BASE = 50;                // 基礎振幅像素（配合 chart.js）
const BEAM_OPACITY = 0.25;
const BEAM_WIDTH_FRAC = 0.08;
const DIAG_FONT = "14px monospace";
const GLOW_RADIUS = 6;
const RIGHT_SAFE_PAD = GLOW_RADIUS + 4; // 右側安全邊界

// 模擬瀏覽器環境的 fetch
global.fetch = async (url, options = {}) => {
  const https = await import('https');
  const http = await import('http');
  
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      ...options
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          json: () => JSON.parse(data),
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
};

// 使用 fetch 的貢獻資料函數
async function fetchContributions(username) {
  try {
    const url = `https://github-contributions-api.jogruber.de/v4/${username}?y=last`;
    console.log(`Fetching from: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch contributions: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('API Response structure:', JSON.stringify(data, null, 2));
    
    // 根據實際 API 回應格式解析
    let contributions = [];
    if (data.contributions && Array.isArray(data.contributions)) {
      contributions = data.contributions;
    } else if (data.data && Array.isArray(data.data)) {
      contributions = data.data;
    } else if (Array.isArray(data)) {
      contributions = data;
    }
    
    if (contributions.length === 0) {
      console.log('No contributions found, using fallback data');
      const fallbackData = new Array(365).fill(0).map(() => Math.floor(Math.random() * 5));
      return { data: fallbackData };
    }

    const contributionData = [];
    contributions.forEach((day, index) => {
      let count = 0;
      if (typeof day.count === 'number') count = day.count;
      else if (typeof day.contributionCount === 'number') count = day.contributionCount;
      else if (typeof day === 'number') count = day;
      contributionData.push(count);
    });
    
    return { data: contributionData };
    
  } catch (error) {
    console.error('Error fetching contributions:', error.message);
    // 如果 API 失敗，返回模擬資料
    const fallbackData = new Array(365).fill(0).map(() => Math.floor(Math.random() * 5));
    return { data: fallbackData };
  }
}

// 簡化版的 ECG 渲染器
class SimpleECGRenderer {
  constructor(width = 1200, height = 800) {
    this.width = width;
    this.height = height;
    this.xTick = 0;
    this.scanOffset = 0;
    this.pointsPerUser = {};
  }

  heartbeatPattern(t, intensity = 1, speed = 200) {
    const scale = AMP_BASE * intensity; // 與 chart.js 對齊
    const phase = (t % speed) / speed;
    
    const QRS_CENTER = 0.82;
    const QRS_WIDTH = 0.1;
    const QRS_LEFT = QRS_CENTER - QRS_WIDTH * 0.5;
    const QRS_RIGHT = QRS_CENTER + QRS_WIDTH * 0.5;

    if (phase >= QRS_LEFT && phase <= QRS_RIGHT) {
      const half = (QRS_LEFT + QRS_RIGHT) / 2;
      const dist = Math.abs(phase - half) / (QRS_WIDTH * 0.5);
      const peak = 1 - dist;
      const Q_DEPTH = -0.55;
      const R_HEIGHT = 1.6;
      const S_DEPTH = -0.45;
      if (phase < half) {
        const blend = peak;
        const val = Q_DEPTH * (1 - blend) + R_HEIGHT * blend;
        return val * scale;
      } else {
        const blend = peak;
        const val = S_DEPTH * (1 - blend) + R_HEIGHT * blend;
        return val * scale;
      }
    }
    // 微噪聲
    const NOISE = 0.05 * scale;
    return (Math.random() - 0.5) * 2 * NOISE;
  }

  generateFrame(canvas, datasets) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // 清空畫面
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    // 網格（與 chart.js 的 GRID_TARGET_COLUMNS 對齊）
    ctx.strokeStyle = "rgba(0,255,0,0.35)";
    ctx.lineWidth = 1;
    const grid = Math.max(20, Math.floor(width / GRID_TARGET_COLUMNS));
    for (let i = 0; i <= width; i += grid) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke(); }
    for (let j = 0; j <= height; j += grid) { ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(width, j); ctx.stroke(); }

    // 版面與軌道
    const TOP_PAD = 10;
    const LEFT_PAD = 10;
    const RIGHT_PAD = RIGHT_SAFE_PAD; // 與 chart.js 一致
    const BOTTOM_PAD = 10;

    const tracks = Math.max(1, datasets.length);
    const usableH = height - TOP_PAD - BOTTOM_PAD;
    const trackH = Math.max(50, Math.floor(usableH / tracks));
    const plotX0 = LEFT_PAD;
    const plotW = Math.max(60, width - LEFT_PAD - RIGHT_PAD);

    datasets.forEach((d, idx) => {
      // 與 chart.js 相同的參數映射
      const avg = d.data.length ? d.data.reduce((a, b) => a + b, 0) / d.data.length : 0;
      const intensity = Math.min(avg * 0.5, 3);
      const speed = Math.max(80, 400 - avg * 10);
      const color = d.color || ['lime', 'cyan', 'yellow', 'magenta'][idx % 4];

      const trackTop = TOP_PAD + idx * trackH;
      const trackMid = trackTop + Math.floor(trackH / 2);

      // 依軌道高度限制振幅
      const expectedScale = AMP_BASE * Math.max(0.001, intensity);
      const maxAmplitude = trackH * 0.45;
      const scaleFactor = Math.min(1, maxAmplitude / expectedScale);

      if (!this.pointsPerUser[d.username]) this.pointsPerUser[d.username] = [];
      const points = this.pointsPerUser[d.username];

      // 確保填滿
      if (points.length < plotW) {
        const pad = plotW - points.length;
        points.unshift(...new Array(pad).fill(trackMid));
      } else if (points.length > plotW) {
        points.splice(0, points.length - plotW);
      }

      // 新增點（含 scaleFactor）
      const yVal = this.heartbeatPattern(this.xTick, intensity, speed) * scaleFactor;
      points.push(trackMid + yVal);
      points.shift();

      // 畫線
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (let i = 0; i < points.length; i++) {
        const x = plotX0 + i;
        const y = points[i];
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 發光點
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

    // 掃描光（與 chart.js 同樣的寬度與透明度）
    const relX = this.scanOffset % plotW;
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

    this.scanOffset = (this.scanOffset + 6) % plotW; // 與 SCAN_SPEED_PX_PER_FRAME=6 對齊

    // 診斷面板（與 chart.js 字型一致）
    ctx.save();
    ctx.font = DIAG_FONT;
    const padX = 10, padY = 10, lineH = 18;
    const rows = [];
    rows.push({ text: "Status for 7days:", color: "rgba(0,255,0,0.9)" });
    datasets.forEach((d, i) => {
      const avg = d.data.length ? d.data.reduce((a, b) => a + b, 0) / d.data.length : 0;
      const status = (avg === 0) ? "💀 No activity" : (avg < 1) ? "⚠️ Low" : (avg < 3) ? "💚 Healthy" : "🔥 Monster";
      const text = `${d.username}: ${status} (avg ${avg.toFixed(2)})`;
      rows.push({ text, color: d.color || ['lime', 'cyan', 'yellow', 'magenta'][i % 4] });
    });
    let maxW = 0;
    rows.forEach(r => { const w = ctx.measureText(r.text).width; if (w > maxW) maxW = w; });
    const panelW = Math.ceil(maxW + padX * 2);
    const panelH = Math.ceil(rows.length * lineH + padY * 2);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, panelW, panelH);
    ctx.shadowColor = "lime";
    ctx.shadowBlur = 8;
    let y = padY + 12;
    rows.forEach((r, idx) => { ctx.fillStyle = idx === 0 ? "rgba(0,255,0,0.9)" : r.color; ctx.fillText(r.text, padX, y); y += lineH; });
    ctx.restore();

    // 波形取樣速度（與 chart.js 的 WAVE_SPEED_MULT 行為一致）
    const phase = (this.xTick % 200) / 200;
    const inQRS = phase >= 0.82 - 0.03 && phase <= 0.82 + 0.03;
    this.xTick += (inQRS ? 2 : 1) * 4; // WAVE_SPEED_MULT = 4
  }
}

// 生成 GIF 的函數
async function generateECGGIF(datasets, outputPath) {
  try {
    // 使用動態 import 載入 gifencoder
    const gifModule = await import('gifencoder');
    const GIFEncoder = gifModule.GIFEncoder || gifModule.default?.GIFEncoder || gifModule.default;
    
    if (!GIFEncoder) {
      throw new Error('GIFEncoder not found in gifencoder module');
    }
    
    // 與 exportECGAsGIFForNode 對齊：寬 400、高 150、fps 15、seconds 60（你目前設定）
    const width = 800;
    const height = 300;
    const fps = 15;
    const seconds = 30;
    const totalFrames = fps * seconds;

    const canvas = createCanvas(width, height);
    const renderer = new SimpleECGRenderer(width, height);

    // 建立 GIF 編碼器
    const encoder = new GIFEncoder(width, height);
    const stream = encoder.createReadStream();

    // 設定 GIF 參數
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(Math.round(1000 / fps));
    encoder.setQuality(30);

    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(outputPath);
      stream.pipe(writeStream);

      writeStream.on('finish', () => {
        console.log(`ECG GIF saved to: ${outputPath}`);
        resolve(outputPath);
      });

      writeStream.on('error', reject);

      let frameCount = 0;
      const renderFrame = () => {
        if (frameCount >= totalFrames) {
          encoder.finish();
          return;
        }

        renderer.generateFrame(canvas, datasets);
        encoder.addFrame(canvas.getContext('2d'));
        frameCount++;

        if (frameCount % Math.floor(totalFrames / 10) === 0) {
          console.log(`Progress: ${Math.round((frameCount / totalFrames) * 100)}%`);
        }

        setTimeout(renderFrame, Math.round(1000 / fps));
      };

      renderFrame();
    });
  } catch (error) {
    console.error('Error in generateECGGIF:', error);
    throw error;
  }
}

// 主函數
async function main() {
  try {
    const username = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
    if (!username) {
      throw new Error('Missing required environment variable: GITHUB_USERNAME or GITHUB_REPOSITORY_OWNER');
    }

    console.log(`Fetching contributions for user: ${username}`);

    const contributions = await fetchContributions(username);
    if (!contributions.data || !Array.isArray(contributions.data) || contributions.data.length === 0) {
      throw new Error('Invalid contribution data received');
    }

    //取過去7天的資料(不含當日)
    const last7Data = contributions.data.slice(contributions.data.length - 8, contributions.data.length - 1);

    const validData = last7Data.filter(count => typeof count === 'number' && !isNaN(count));
    if (validData.length === 0) {
      throw new Error('No valid contribution data found');
    }

    const datasets = [{ username, data: validData, color: 'lime' }];
    const imagesDir = path.join(__dirname, '..', 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const gifPath = path.join(imagesDir, 'daily-ecg.gif');
    await generateECGGIF(datasets, gifPath);

    console.log('Daily ECG generation completed successfully!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
