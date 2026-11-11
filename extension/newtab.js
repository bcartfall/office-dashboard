// Change this if you run the server on another port (PORT=4000 npm start).
const DASHBOARD_URL = 'http://localhost:3944/';

async function go() {
  try {
    // no-cors: we only care whether the server answers at all (the response is opaque).
    await fetch(DASHBOARD_URL + 'api/health', { cache: 'no-store', mode: 'no-cors' });
    // location.replace keeps the back button clean and gives the page a normal origin.
    location.replace(DASHBOARD_URL);
  } catch {
    document.getElementById('offline').hidden = false;
  }
}

document.getElementById('retry').addEventListener('click', (e) => {
  e.preventDefault();
  go();
});
go();
