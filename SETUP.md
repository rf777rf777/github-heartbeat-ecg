# 🚀 Setup Guide for GitHub Heartbeat ECG

## 📋 Prerequisites

- A GitHub account
- A forked copy of this repository
- Basic knowledge of GitHub Actions

## 🏗️ Step 1: Fork and Clone Repository

1. **Fork this repository** to your GitHub account
2. **Clone your forked repository** to your local machine:
   ```bash
   git clone https://github.com/YOUR_USERNAME/github-heartbeat-ecg.git
   cd github-heartbeat-ecg
   ```

## ⚙️ Step 2: Enable GitHub Actions

1. In your forked repository, click on **Actions** tab
2. If you see a message about enabling Actions, click **Enable Actions**
3. The workflow should now be visible and ready to run

## 🧪 Step 3: Test the Setup

1. **Manual Trigger**: Go to Actions → Daily ECG Generation → Run workflow
2. **Check Results**: Monitor the workflow execution
3. **Verify Output**: Check that `images/daily-ecg.gif` is generated and README is updated

## 📅 Step 4: Verify Daily Automation

The workflow is scheduled to run daily at **UTC 00:00** (08:00 Taiwan time). You can:

1. Check the **Actions** tab daily to see if it ran successfully
2. Look for new commits with the message "🤖 Daily ECG update - YYYY-MM-DD"
3. Verify that the README shows the latest status

## 🔧 How It Works

This system uses **public GitHub APIs** to fetch your contribution data:

- **No Personal Access Token required** - uses public contribution data
- **Automatic username detection** - gets your username from the repository owner
- **Daily updates** - generates new ECG visualization every day
- **Public data only** - only accesses publicly available contribution information

## 🎨 Customization Options

### Modify ECG Appearance

Edit `src/chart.js` to customize:

```javascript
const WAVE_SPEED_MULT = 4;         // Waveform speed (higher = faster)
const SCAN_SPEED_PX_PER_FRAME = 6; // Scanning beam speed
const AMP_BASE = 50;               // Base amplitude
const GRID_TARGET_COLUMNS = 40;    // Grid density
```

### Change Schedule

Edit `.github/workflows/daily-ecg.yml`:

```yaml
on:
  schedule:
    # Run every 6 hours instead of daily
    - cron: '0 */6 * * *'
```

### Adjust GIF Settings

Edit `scripts/generate-daily-ecg.js`:

```javascript
const fps = 15;        // Frames per second
const seconds = 8;     // GIF duration
const quality = 10;    // GIF quality (1-20, lower = better)
```

## 🚨 Troubleshooting

### Common Issues

1. **"User not found"**
   - Verify your GitHub username is correct
   - Ensure your account is public and not suspended

2. **"Missing required environment variables"**
   - The workflow automatically detects your username from repository owner
   - No manual configuration needed

3. **"Permission denied"**
   - Ensure the repository is not archived
   - Check that Actions are enabled

4. **Workflow not running**
   - Verify Actions are enabled in repository settings
   - Check the cron schedule in the workflow file

### Debug Steps

1. **Check workflow logs**: Go to Actions → click on the workflow run → view logs
2. **Test locally**: Run `node scripts/generate-daily-ecg.js` locally
3. **Verify username**: Check that `GITHUB_REPOSITORY_OWNER` is set correctly

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Contribution Graph](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-github-profile/managing-contribution-settings-on-your-profile/viewing-contributions-on-your-profile)
- [Public GitHub APIs](https://docs.github.com/en/rest/overview/resources-in-the-rest-api)

## 🤝 Need Help?

If you encounter issues:

1. Check the troubleshooting section above
2. Review the workflow logs in the Actions tab
3. Open an issue in this repository
4. Check the [GitHub Community](https://github.com/orgs/community/discussions)

---

**Happy coding! 🎉**
