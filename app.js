export const games = [
  {id:'1', name:'东方灵异传', subtitle:'Highly Responsive to Prayers', dir:'REIIDEN', year:'1997', color:'#ef4444', tag:'TH01'},
  {id:'2', name:'东方封魔录', subtitle:'Story of Eastern Wonderland', dir:'HUMAROKU', year:'1997', color:'#a855f7', tag:'TH02'},
  {id:'3', name:'东方梦时空', subtitle:'Phantasmagoria of Dim.Dream', dir:'YUMEZIKU', year:'1997', color:'#06b6d4', tag:'TH03'},
  {id:'4', name:'东方幻想乡', subtitle:'Lotus Land Story', dir:'GENSO', year:'1998', color:'#10b981', tag:'TH04'},
  {id:'5', name:'东方怪绮谈', subtitle:'Mystic Square', dir:'KAIKI', year:'1998', color:'#f59e0b', tag:'TH05'},
];

const container = document.querySelector('#games');
if (container) {
  const language = document.querySelector('#language');
  const langButtons = document.querySelectorAll('.lang-btn');

  function render() {
    container.replaceChildren(...games.map(game => {
      const lang = game.id === '1' ? 'jp' : (language ? language.value : 'jp');
      const link = document.createElement('a');
      link.className = 'game-card';
      link.href = `player.html?game=${game.id}&lang=${lang}`;
      link.style.setProperty('--card-accent', game.color);
      link.innerHTML = `
        <div class="card-accent-bar"></div>
        <div class="card-header">
          <span class="game-tag">${game.tag}</span>
          <span class="game-year">${game.year}</span>
        </div>
        <div class="card-body">
          <h2 class="game-title">${game.name}</h2>
          <p class="game-subtitle">${game.subtitle}</p>
        </div>
        <div class="card-footer">
          <span class="play-action">
            <span>开始游戏</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </span>
        </div>
      `;
      return link;
    }));
  }

  if (langButtons.length) {
    langButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        langButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (language) {
          language.value = btn.dataset.lang;
          language.dispatchEvent(new Event('change'));
        }
      });
    });
  }

  language?.addEventListener('change', render);
  render();
}
