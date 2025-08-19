export function getUsernames() {
  const inputs = document.querySelectorAll('.username');
  return Array.from(inputs)
    .map(el => el.innerHTML.trim())
    .filter(name => name.length > 0);
}
