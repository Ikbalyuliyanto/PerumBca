// Skrip kecil tanpa inline JS (CSP ketat).
(function () {
  // Konfirmasi sebelum submit: <form data-confirm="pesan">
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Format input uang: <input data-money>
  document.querySelectorAll('input[data-money]').forEach(function (el) {
    el.addEventListener('input', function () {
      var d = el.value.replace(/\D/g, '');
      el.value = d ? Number(d).toLocaleString('id-ID') : '';
    });
  });

  // Pilih rumah → muat ulang halaman dengan ?rumah=
  var sel = document.querySelector('select[data-reload-param]');
  if (sel) sel.addEventListener('change', function () {
    var u = new URL(window.location.href);
    u.searchParams.set(sel.getAttribute('data-reload-param'), sel.value);
    window.location.href = u.toString();
  });

  // Mode alokasi manual
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var box = document.getElementById('alok-manual');
      if (box) box.classList.toggle('d-none', r.value !== 'manual' || !r.checked);
    });
  });

  // Pilih semua checkbox: <input type=checkbox data-check-all="name">
  document.querySelectorAll('[data-check-all]').forEach(function (c) {
    c.addEventListener('change', function () {
      document.querySelectorAll('input[name="' + c.getAttribute('data-check-all') + '"]').forEach(function (x) { x.checked = c.checked; });
    });
  });

  // Salin teks: <button data-copy="teks">
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () { b.textContent = 'Tersalin'; });
    });
  });

  // Komponen kebijakan: tambah baris
  var addRow = document.getElementById('add-komponen');
  if (addRow) addRow.addEventListener('click', function () {
    var tpl = document.getElementById('komponen-tpl');
    document.getElementById('komponen-body').appendChild(tpl.content.cloneNode(true));
  });
  // Kode komponen → nilai checkbox aktif ikut kode
  document.addEventListener('input', function (e) {
    if (e.target.name === 'k_kode') {
      var row = e.target.closest('tr');
      var cb = row && row.querySelector('input[name="k_aktif"]');
      if (cb) cb.value = e.target.value.trim().toUpperCase();
    }
  });

  // Midtrans Snap
  var payBtn = document.getElementById('pay-midtrans');
  if (payBtn) payBtn.addEventListener('click', function () {
    payBtn.disabled = true;
    var body = new URLSearchParams({ _csrf: payBtn.dataset.csrf });
    fetch(payBtn.dataset.url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) throw new Error(j.error);
        var s = document.createElement('script');
        s.src = j.snapJs; s.setAttribute('data-client-key', j.clientKey);
        s.onload = function () {
          window.snap.pay(j.token, {
            onSuccess: function () { window.location.href = '/r/selesai'; },
            onPending: function () { window.location.href = '/r/selesai'; },
            onClose: function () { payBtn.disabled = false; },
            onError: function () { alert('Pembayaran gagal.'); payBtn.disabled = false; },
          });
        };
        document.body.appendChild(s);
      })
      .catch(function (e) { alert(e.message); payBtn.disabled = false; });
  });
})();
