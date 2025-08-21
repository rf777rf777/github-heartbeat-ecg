import { showMessage } from './msgBox.js';

// ✅ Make sure this is exported
export async function fetchContributions(username) {
  // ⚠️ DO NOT commit this token in a public repo
  const token = "[Github Token]";

  const query = `
    query {
      user(login: "${username}") {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `bearer ${token}`
    },
    body: JSON.stringify({ query })
  });

  const json = await response.json();
  if (!json.data.user) {
    await showMessage(`User not found: ${username}`, { title: "Oops..." });
    return { labels: [], data: [] };
  }

  const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
  const days = weeks.flatMap(w => w.contributionDays);

  return {
    labels: days.map(d => d.date),
    data: days.map(d => d.contributionCount)
  };
}
