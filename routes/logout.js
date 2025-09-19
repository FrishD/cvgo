// logout.js
function logout() {
    fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + localStorage.getItem('authToken')
        }
    })
        .then(() => {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            sessionStorage.clear();
            window.location.href = '/login.html';
        })
        .catch(() => {
            // גם אם יש שגיאה, ננקה את הטוקן
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            window.location.href = '/login.html';
        });
}