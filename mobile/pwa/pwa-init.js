/* 由网关注入到 Streamlit 顶层页面，负责注册 Service Worker。
   用外部脚本而不是内联脚本，避免被页面的 CSP 拦下。 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  var start = function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {
      /* 非 HTTPS 环境下浏览器不提供 serviceWorker，静默降级为普通网页 */
    });
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
