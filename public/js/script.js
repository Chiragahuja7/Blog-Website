document.addEventListener('DOMContentLoaded', function () {
  const allButtons = document.querySelectorAll('.searchBtn');
  const searchBar = document.querySelector('.searchBar');
  const searchInput = document.getElementById('searchInput');
  const searchClose = document.getElementById('searchClose');

  if (searchBar && searchInput) {
    allButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        searchBar.style.visibility = 'visible';
        searchBar.classList.add('open');
        this.setAttribute('aria-expanded', true);
        searchInput.focus();
      });
    });
  }

  if (searchBar && searchClose) {
    searchClose.addEventListener('click', function () {
      searchBar.style.visibility = 'hidden';
      searchBar.classList.remove('open');
      this.setAttribute('aria-expanded', false);
    });
  }
});
