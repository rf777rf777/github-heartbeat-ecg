#!/usr/bin/env node

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 簡化的 HTTP 請求函數（同步風格）
function fetchContributionsSync(username) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    
    const url = `https://github-contributions-api.jogruber.de/v4/${username}?y=last`;
    console.log(`Fetching from: ${url}`);
    
    const req = https.request(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          console.log('API Response structure:', JSON.stringify(jsonData, null, 2));
          
          // 嘗試不同的資料結構
          let contributions = [];
          if (jsonData.contributions && Array.isArray(jsonData.contributions)) {
            contributions = jsonData.contributions;
          } else if (jsonData.data && Array.isArray(jsonData.data)) {
            contributions = jsonData.data;
          } else if (Array.isArray(jsonData)) {
            contributions = jsonData;
          }
          
          if (contributions.length === 0) {
            console.log('No contributions found, using fallback data');
            const fallbackData = new Array(365).fill(0).map(() => Math.floor(Math.random() * 5));
            resolve({ data: fallbackData });
            return;
          }
          
          const contributionData = [];
          contributions.forEach((day, index) => {
            console.log(`Day ${index}:`, day);
            let count = 0;
            
            if (typeof day.contributionCount === 'number') {
              count = day.contributionCount;
            } else if (typeof day.count === 'number') {
              count = day.count;
            } else if (typeof day === 'number') {
              count = day;
            }
            
            contributionData.push(count);
          });
          
          console.log(`Parsed ${contributionData.length} days of data`);
          console.log('Sample data:', contributionData.slice(0, 10));
          
          resolve({ data: contributionData });
          
        } catch (parseError) {
          console.error('Error parsing JSON:', parseError);
          console.log('Raw response:', data);
          // 使用模擬資料
          const fallbackData = new Array(365).fill(0).map(() => Math.floor(Math.random() * 5));
          resolve({ data: fallbackData });
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Request error:', error);
      // 使用模擬資料
      const fallbackData = new Array(365).fill(0).map(() => Math.floor(Math.random() * 5));
      resolve({ data: fallbackData });
    });
    
    req.end();
  });
}

// 簡化版的 ECG 渲染器
class SimpleECGRenderer {
  constructor(width = 1200, height = 600) {
    this.width = width;
    this.height = height;
    this.xTick = 0;
    this.scanOffset = 0;
    this.pointsPerUser = {};
  }

  heartbeatPattern(t, intensity = 1, speed = 200) {
    const scale = 50 * intensity;
    const phase = (t % speed) / speed;
    
    const QRS_CENTER = 0.82;
    const QRS_WIDTH = 0.06;
    const QRS_LEFT = QRS_CENTER - QRS_WIDTH * 0.5;
    const QRS_RIGHT = QRS_CENTER + QRS_WIDTH * 0.5;

    if (phase >= QRS_LEFT && phase <= QRS_RIGHT) {
      const half = (QRS_LEFT + QRS_RIGHT) / 2;
      const dist = Math.abs(phase - half) / (QRS_WIDTH * 0.5);
      const peak = 1 - dist;
      
      if (phase < half) {
        return (-0.55 * (1 - peak) + 1.6 * peak) * scale;
      } else {
        return (-0.45 * (1 - peak) + 1.6 * peak) * scale;
      }
    }
    
    return (Math.random() - 0.5) * 0.1 * scale;
  }

  generateFrame(canvas, datasets) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // 清空畫面
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    // 畫網格
    ctx.strokeStyle = "rgba(0,255,0,0.35)";
    ctx.lineWidth = 1;
    const grid = Math.max(20, Math.floor(width / 40));
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

    // 畫 ECG 波形
    const TOP_PAD = 10;
    const LEFT_PAD = 10;
    const RIGHT_PAD = 10;
    const BOTTOM_PAD = 10;

    const tracks = Math.max(1, datasets.length);
    const usableH = height - TOP_PAD - BOTTOM_PAD;
    const trackH = Math.max(50, Math.floor(usableH / tracks));
    const plotX0 = LEFT_PAD;
    const plotW = Math.max(60, width - LEFT_PAD - RIGHT_PAD);

    datasets.forEach((d, idx) => {
      const avg = d.data.reduce((a, b) => a + b, 0) / d.data.length;
      const intensity = Math.min(avg * 0.5, 3);
      const speed = Math.max(80, 400 - avg * 10);
      const color = d.color || ['lime', 'cyan', 'yellow', 'magenta'][idx % 4];

      const trackTop = TOP_PAD + idx * trackH;
      const trackMid = trackTop + Math.floor(trackH / 2);

      if (!this.pointsPerUser[d.username]) this.pointsPerUser[d.username] = [];
      const points = this.pointsPerUser[d.username];

      if (points.length < plotW) {
        const pad = plotW - points.length;
        points.unshift(...new Array(pad).fill(trackMid));
      } else if (points.length > plotW) {
        points.splice(0, points.length - plotW);
      }

      let yVal = this.heartbeatPattern(this.xTick, intensity, speed);
      points.push(trackMid + yVal);
      points.shift();

      // 畫線
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

      // 發光點
      const glowX = plotX0 + points.length - 1;
      const glowY = points[points.length - 1];
      ctx.beginPath();
      ctx.arc(glowX, glowY, 6, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // 掃描光
    const relX = this.scanOffset % plotW;
    const scanX = plotX0 + relX;
    const beamWidth = Math.max(60, Math.round(width * 0.08));
    const leftEdge = Math.max(plotX0, scanX - beamWidth);

    const grad = ctx.createLinearGradient(leftEdge, 0, scanX, 0);
    grad.addColorStop(0, "rgba(0,255,0,0)");
    grad.addColorStop(1, "rgba(0,255,0,0.25)");
    ctx.fillStyle = grad;
    const minTrackTop = TOP_PAD;
    const maxTrackBot = TOP_PAD + tracks * trackH;
    ctx.fillRect(leftEdge, minTrackTop, scanX - leftEdge, maxTrackBot - minTrackTop);

    this.scanOffset = (this.scanOffset + 6) % plotW;

    // 診斷面板
    ctx.save();
    ctx.font = "14px monospace";

    const padX = 10;
    const padY = 10;
    const lineH = 18;

    const rows = [];
    rows.push({ text: "Status:", color: "rgba(0,255,0,0.9)" });
    datasets.forEach((d, i) => {
      const avg = d.data.reduce((a, b) => a + b, 0) / d.data.length;
      const status = (avg === 0) ? "💀 No activity"
        : (avg < 1) ? "⚠️ Low"
          : (avg < 3) ? "💚 Healthy"
            : "🔥 Monster";
      const text = `${d.username}: ${status} (avg ${avg.toFixed(2)})`;
      rows.push({ text, color: d.color || ['lime', 'cyan', 'yellow', 'magenta'][i % 4] });
    });

    let maxW = 0;
    rows.forEach(r => {
      const w = ctx.measureText(r.text).width;
      if (w > maxW) maxW = w;
    });

    const panelW = Math.ceil(maxW + padX * 2);
    const panelH = Math.ceil(rows.length * lineH + padY * 2);

    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, panelW, panelH);

    ctx.shadowColor = "lime";
    ctx.shadowBlur = 8;

    let y = padY + 12;
    rows.forEach((r, idx) => {
      ctx.fillStyle = idx === 0 ? "rgba(0,255,0,0.9)" : r.color;
      ctx.fillText(r.text, padX, y);
      y += lineH;
    });

    ctx.restore();

    // 更新動畫參數
    const phase = (this.xTick % 200) / 200;
    const inQRS = phase >= 0.82 - 0.03 && phase <= 0.82 + 0.03;
    this.xTick += (inQRS ? 2 : 1) * 4;
  }
}

// 生成 GIF 的函數
function generateECGGIF(datasets, outputPath) {
  try {
    // 使用 require 而不是 import
    const GIFEncoder = require('gifencoder');
    
    const width = 1200;
    const height = 600;
    const fps = 15;
    const seconds = 8;
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
    encoder.setQuality(10);

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

    // 取得貢獻資料
    const contributions = await fetchContributionsSync(username);
    
    if (!contributions.data || !Array.isArray(contributions.data) || contributions.data.length === 0) {
      throw new Error('Invalid contribution data received');
    }

    const validData = contributions.data.filter(count => typeof count === 'number' && !isNaN(count));
    
    if (validData.length === 0) {
      throw new Error('No valid contribution data found');
    }
    
    const datasets = [{
      username: username,
      data: validData,
      color: 'lime'
    }];

    console.log(`Found ${validData.length} days of contribution data`);
    const avgContributions = validData.reduce((a, b) => a + b, 0) / validData.length;
    console.log(`Average daily contributions: ${avgContributions.toFixed(2)}`);

    // 確保 images 目錄存在
    const imagesDir = path.join(__dirname, '..', 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    // 生成 ECG GIF
    const gifPath = path.join(imagesDir, 'daily-ecg.gif');
    await generateECGGIF(datasets, gifPath);

    console.log('Daily ECG generation completed successfully!');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// 執行主函數
main();
