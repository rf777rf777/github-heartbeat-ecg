# GitHub Heartbeat ECG

## 📊 Daily Activity Monitor

This repository automatically generates an ECG visualization of your daily GitHub contributions.

![Daily ECG](images/daily-ecg.gif)

## 🔧 How it works

- **Automated**: Updates daily via GitHub Actions
- **Real-time**: Shows your actual contribution data from public GitHub APIs
- **Beautiful**: ECG-style visualization with your activity patterns
- **No setup required**: Uses public data, no Personal Access Token needed

## 📈 Current Status

Last updated: Initial setup

## 🚀 Features

- **ECG-style visualization**: Your GitHub activity displayed as a heartbeat monitor
- **Real-time data**: Fetches your actual contribution data from public GitHub APIs
- **Automated updates**: Daily generation via GitHub Actions
- **Beautiful UI**: Green grid, scanning beam, glowing tips, and status panel
- **Zero configuration**: Automatically detects your username from repository owner

## 🛠️ Setup

1. **Fork this repository** to your GitHub account
2. **Enable GitHub Actions** in your forked repository
3. **That's it!** No tokens or secrets needed

The system automatically:
- Detects your GitHub username from the repository owner
- Fetches your public contribution data
- Generates daily ECG visualizations
- Updates the README with current status

## 📁 Project Structure

```
├── .github/workflows/          # GitHub Actions workflows
├── src/                        # Source code
│   ├── chart.js               # ECG rendering logic
│   ├── api.js                 # GitHub API integration
│   ├── ui.js                  # User interface
│   └── msgBox.js              # Message display
├── scripts/                    # Node.js scripts
│   └── generate-daily-ecg.js  # Daily ECG generation script
├── images/                     # Generated ECG GIFs
└── index.html                 # Web interface
```

## 🔄 Daily Workflow

The GitHub Action runs every day at UTC 00:00 (08:00 Taiwan time) and:

1. Fetches your contribution data from public GitHub APIs
2. Generates a new ECG GIF visualization
3. Updates the README with current status
4. Commits and pushes the changes

## 🎨 Customization

You can customize the ECG appearance by modifying constants in `src/chart.js`:

- `WAVE_SPEED_MULT`: Controls how fast the waveform moves
- `SCAN_SPEED_PX_PER_FRAME`: Controls scanning beam speed
- `AMP_BASE`: Controls waveform amplitude
- Colors, grid density, and more

## 📱 Web Interface

Visit the `index.html` file to see a live, interactive version of your ECG visualization in the browser.

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
