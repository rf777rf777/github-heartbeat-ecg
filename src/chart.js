import Chart from "chart.js/auto";

let ecgChart;

export function drawMultiChart(datasets) {
  const ctx = document.getElementById("ecgChart").getContext("2d");

  if (ecgChart) {
    ecgChart.destroy();
  }

  ecgChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: Array(200).fill(""), // 模擬心電圖長度
      datasets: datasets.map((d, i) => ({
        label: d.username,
        data: generateECGWave(),
        borderColor: getColor(i),
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        tension: 0.2
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { labels: { color: "#0f0" } } },
      scales: {
        x: { display: false },
        y: {
          min: -2,
          max: 3,
          grid: { color: "#003300" },
          ticks: { display: false }
        }
      }
    }
  });

  animateECG();
}

// 模擬心電圖波形
function generateECGWave() {
  const wave = [];
  for (let i = 0; i < 200; i++) {
    if (i % 50 === 0) {
      wave.push(2.5); // R波
    } else if (i % 50 === 5) {
      wave.push(-1); // S波
    } else if (i % 50 === 25) {
      wave.push(1); // T波
    } else {
      wave.push(Math.random() * 0.2 - 0.1); // baseline noise
    }
  }
  return wave;
}

// 動態滾動效果
function animateECG() {
  setInterval(() => {
    ecgChart.data.datasets.forEach(ds => {
      ds.data.shift();
      ds.data.push(Math.random() * 0.2 - 0.1);
    });
    ecgChart.update("none"); // 立即更新不加動畫
  }, 100);
}

function getColor(i) {
  const colors = ["#0f0", "#0ff", "#ff0", "#f0f"];
  return colors[i % colors.length];
}
