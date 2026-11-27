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
    var body = document.getElementById('komponen-body');
    var rows = body.querySelectorAll('tr');
    var cb = rows[rows.length - 1].querySelector('input[name="aktif"]');
    if (cb && cb.value === 'NEW') cb.value = String(rows.length - 1);
    rows[rows.length - 1].querySelectorAll('input[data-money]').forEach(function (el) { el.addEventListener('input', function () { var d = el.value.replace(/D/g, ''); el.value = d ? Number(d).toLocaleString('id-ID') : ''; }); });
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

// Sidebar mobile
(function () {
  document.querySelectorAll('[data-toggle-sidebar]').forEach(function (b) {
    b.addEventListener('click', function () { document.body.classList.toggle('sidebar-open'); });
  });
})();

// Halaman centang iuran: hitung total & tombol centang baris/kolom/semua
(function () {
  var form = document.getElementById('pay-form');
  if (!form) return;
  var boxes = form.querySelectorAll('input[name="p"]');
  var out = document.getElementById('pay-total');
  var cnt = document.getElementById('pay-count');
  var btn = document.getElementById('pay-submit');
  function hitung() {
    var t = 0, n = 0;
    boxes.forEach(function (b) { if (b.checked) { t += Number(b.dataset.nominal || 0); n++; } });
    out.textContent = 'Rp' + t.toLocaleString('id-ID');
    cnt.textContent = n + ' iuran dipilih';
    btn.disabled = n === 0;
  }
  function toggle(sel) {
    var list = form.querySelectorAll(sel);
    var allOn = Array.prototype.every.call(list, function (b) { return b.checked; });
    list.forEach(function (b) { b.checked = !allOn; });
    hitung();
  }
  form.addEventListener('change', hitung);
  form.querySelectorAll('[data-row]').forEach(function (b) { b.addEventListener('click', function () { toggle('input[data-periode="' + b.dataset.row + '"]'); }); });
  form.querySelectorAll('[data-col]').forEach(function (b) { b.addEventListener('click', function () { toggle('input[data-kode="' + b.dataset.col + '"]'); }); });
  var all = document.getElementById('pay-all');
  if (all) all.addEventListener('click', function () { toggle('input[name="p"]'); });
  hitung();
})();

// Tooltip & popover Bootstrap
(function () {
  if (!window.bootstrap) return;
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) { new bootstrap.Tooltip(el); });
  document.querySelectorAll('[data-bs-toggle="popover"]').forEach(function (el) { new bootstrap.Popover(el); });
})();

// Pop-up detail status iuran per rumah (halaman Bayar)
(function () {
  var modalEl = document.getElementById('detail-modal');
  if (!modalEl || !window.bootstrap) return;
  var modal = new bootstrap.Modal(modalEl);
  var TXT = { LUNAS: ['✓', 'Sudah dibayar', 'text-success'], SEBAGIAN: ['⚠', 'Sebagian', 'text-warning'], BELUM: ['✗', 'Belum dibayar', 'text-danger'], BEBAS: ['–', 'Tidak wajib', 'text-muted'] };
  document.querySelectorAll('[data-detail]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = JSON.parse(b.getAttribute('data-detail'));
      document.getElementById('dm-title').textContent = 'Rumah ' + d.kode;
      document.getElementById('dm-sub').textContent = d.nama || '';
      document.getElementById('dm-sisa').textContent = d.sisa;
      var ul = document.getElementById('dm-list');
      ul.innerHTML = '';
      d.items.forEach(function (it) {
        var t = TXT[it.st] || TXT.BELUM;
        var li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        var left = document.createElement('div');
        left.innerHTML = '<div class="fw-semibold"></div><div class="small text-muted"></div>';
        left.children[0].textContent = it.nama;
        left.children[1].textContent = it.nominal;
        var right = document.createElement('span');
        right.className = 'fw-semibold small ' + t[2];
        right.textContent = t[0] + ' ' + t[1];
        li.appendChild(left); li.appendChild(right); ul.appendChild(li);
      });
      document.getElementById('dm-pilih').href = b.getAttribute('data-pilih');
      modal.show();
    });
  });
})();
