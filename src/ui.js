export function getUsernames() {
  const inputs = document.querySelectorAll('.username');
  return Array.from(inputs)
    .map(el => el.innerHTML.trim())
    .filter(name => name.length > 0);
}

export function removeUserByName(name) {
  const el = Array.from(document.querySelectorAll('#userList .username'))
                  .find(el => el.textContent.trim() === name);
  if (el) {
    el.parentElement.querySelector('.remove-btn').click();
  }
}
