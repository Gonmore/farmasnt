const http = require('http');

async function api(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    
    const req = http.request({
      hostname: 'localhost', port: 6001, path, method, headers
    }, res => {
      let b = '';
      res.on('data', d => b += d.toString());
      res.on('end', () => {
        resolve({ status: res.statusCode, body: b });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // Login
  const login = await api('/api/v1/auth/login', 'POST', { email: 'admin@demo.local', password: 'Admin123!' });
  console.log('Login Status:', login.status);
  const token = JSON.parse(login.body).accessToken;
  
  // Get warehouses
  const whs = await api('/api/v1/warehouses', 'GET', null, token);
  console.log('Warehouses Status:', whs.status);
  const whList = JSON.parse(whs.body).items;
  console.log('Warehouses:', whList.length);
  whList.forEach(w => console.log(' -', w.id, w.code, w.type));
  
  // Create SAMPLES location
  if (whList.length > 0) {
    const loc = await api('/api/v1/warehouses/' + whList[0].id + '/locations', 'POST', { code: 'TEST-SAMPLES', type: 'SAMPLES' }, token);
    console.log('Create Status:', loc.status);
    console.log('Response:', loc.body);
  }
})();
