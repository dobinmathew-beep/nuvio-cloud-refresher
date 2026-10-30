// Shared browser/server validation. URLs are returned to the client, never fetched here.
export function normalizePosterTemplate(value){
 let s=String(value||'').trim();if(!s)return '';if(s.length>1800)throw Error('The poster URL is too long.');
 if(!/\{(?:imdbId|imdb|id)\}/.test(s))s=s.replace(/tt\d{5,12}/,'{imdbId}');
 if(!/\{(?:imdbId|imdb|id)\}/.test(s))throw Error('Paste a full poster URL containing an IMDb ID, or use {imdbId} where the ID belongs.');
 if(/\{(?!imdbId\}|imdb\}|id\})/.test(s))throw Error('Use only {imdbId}, {imdb}, or {id} as the title placeholder.');
 let u;try{u=new URL(s.replace(/\{(?:imdbId|imdb|id)\}/g,'tt0133093'))}catch{throw Error('Enter a valid HTTPS poster URL.')}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port||!u.hostname.includes('.')||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)||u.hostname.endsWith('.local')||u.hostname.includes(':'))throw Error('Use a public HTTPS poster URL without login credentials, a port, or a fragment.');
 return s;
}
export function encodePosterConfig(template){const s=normalizePosterTemplate(template);return s?btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):''}
export function decodePosterConfig(token){if(!token||token.length>2600||!/^[\w-]+$/.test(token))throw Error('Invalid poster configuration.');return normalizePosterTemplate(decodeURIComponent(escape(atob(token.replace(/-/g,'+').replace(/_/g,'/')))))}
export function ratedPoster(template,id,fallback){return template&&/^tt\d+$/.test(id)?template.replace(/\{(?:imdbId|imdb|id)\}/g,id):fallback}
