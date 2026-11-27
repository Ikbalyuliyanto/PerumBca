// Dari Dasher (inline script dipindah ke file agar sesuai CSP)
if (localStorage.getItem('sidebarExpanded') === 'false') {
  document.documentElement.classList.add('collapsed');
  document.documentElement.classList.remove('expanded');
} else {
  document.documentElement.classList.remove('collapsed');
  document.documentElement.classList.add('expanded');
}
