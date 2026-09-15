/* ============================================================
   Landings VBR Nettoyage (Côtes-d'Armor 22 / Essonne 91)
   - capture gclid / utm_* pour rattacher chaque lead à sa campagne
   - envoi Web3Forms (FormData obligatoire : le JSON déclenche un
     preflight CORS que Web3Forms refuse)
   - événements dataLayer : generate_lead, phone_call, form_start
   - la page s'identifie via <body data-lp="..."> (service + zone)
   ============================================================ */
(function () {
  'use strict';

  var dl = (window.dataLayer = window.dataLayer || []);
  var STORE = 'lp_vbr_src';
  var LP = document.body.getAttribute('data-lp') || 'landing_vbr';

  /* ---------- 1. Traçabilité Google Ads ---------- */
  var params = new URLSearchParams(window.location.search);
  var src = {
    gclid: params.get('gclid') || params.get('wbraid') || params.get('gbraid') || '',
    source: params.get('utm_source') || '',
    campagne: params.get('utm_campaign') || '',
    mot_cle: params.get('utm_term') || params.get('keyword') || ''
  };
  /* On garde la source d'origine même si le visiteur revient plus tard sans paramètres.
     Le terme de recherche compte comme une source : sans lui dans le test, une
     visite précédente écraserait la requête réellement tapée. */
  try {
    if (src.gclid || src.source || src.campagne || src.mot_cle) {
      sessionStorage.setItem(STORE, JSON.stringify(src));
    } else {
      var saved = sessionStorage.getItem(STORE);
      if (saved) src = JSON.parse(saved);
    }
  } catch (e) { /* navigation privée : on continue sans mémoriser */ }

  function fill(name, value) {
    document.querySelectorAll('input[type="hidden"][name="' + name + '"]').forEach(function (el) {
      el.value = value || '';
    });
  }
  fill('gclid', src.gclid);
  fill('source', src.source || (document.referrer ? 'referrer' : 'direct'));
  fill('campagne', src.campagne);
  fill('mot_cle', src.mot_cle);
  fill('page', window.location.href);

  /* ---------- 2. Conversion Google Ads ---------- */
  /* Deux actions distinctes : ADS_CONVERSION (devis) et ADS_CONVERSION_APPEL. */
  function sendTo(id) {
    if (typeof window.gtag === 'function' && id && id.indexOf('XXXX') === -1) {
      window.gtag('event', 'conversion', { send_to: id });
    }
  }
  /* Conversions améliorées : gtag hache lui-même le téléphone et le nom avant
     de les envoyer (rien de lisible ne quitte le navigateur). Ça rattrape les
     conversions que Safari/iOS font perdre, majoritaires sur ce trafic mobile. */
  function telE164(v) {
    var n = (v || '').replace(/[^0-9+]/g, '');
    if (n.indexOf('+') === 0) return n;
    if (n.indexOf('00') === 0) return '+' + n.slice(2);
    if (n.indexOf('0') === 0 && n.length === 10) return '+33' + n.slice(1);
    return n ? '+33' + n : '';
  }
  /* Lu AVANT l'envoi : form.reset() vide les champs, et la conversion part
     après. Si on relisait le formulaire à ce moment-là, on n'enverrait rien. */
  function lireIdentite(form) {
    if (!form) return null;
    return {
      tel: telE164((form.querySelector('[name=tel]') || {}).value),
      nom: ((form.querySelector('[name=nom]') || {}).value || '').trim()
    };
  }
  function setUserData(ident) {
    if (typeof window.gtag !== 'function' || !ident) return;
    var tel = ident.tel, nom = ident.nom;
    if (!tel && !nom) return;
    var ud = {};
    if (tel) ud.phone_number = tel;
    if (nom) {
      var bouts = nom.split(/\s+/);
      ud.address = { first_name: bouts[0], last_name: bouts.slice(1).join(' ') || bouts[0] };
    }
    window.gtag('set', 'user_data', ud);
  }
  function reportConversion(type, ident) {
    setUserData(ident);
    sendTo(window.ADS_CONVERSION || '');
    dl.push({ event: type, form_location: LP });
  }

  /* ---------- 3. Clic téléphone ---------- */
  document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
    a.addEventListener('click', function () {
      dl.push({ event: 'phone_call', link_url: a.getAttribute('href'), form_location: LP });
      sendTo(window.ADS_CONVERSION_APPEL || window.ADS_CONVERSION || '');
    });
  });

  /* ---------- 4. Formulaires (haut de page et bas de page) ---------- */
  var started = false;
  document.querySelectorAll('form.js-devis').forEach(function (form) {
    form.addEventListener('input', function () {
      if (started) return;
      started = true;
      dl.push({ event: 'form_start', form_location: LP });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var success = form.querySelector('.form-success');
      var error = form.querySelector('.form-error');
      var btn = form.querySelector('button[type="submit"]');
      success.style.display = 'none';
      error.style.display = 'none';

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      var key = form.querySelector('[name="access_key"]').value;
      if (!key || key.indexOf('REMPLACER') !== -1) {
        error.style.display = 'block';
        return;
      }

      var data = new FormData(form);
      data.append('subject', 'VBR Nettoyage · nouvelle demande de devis (' + LP + ')');
      data.append('from_name', 'VBR Nettoyage · landing ' + LP);
      data.append('formulaire', form.id === 'devis-form' ? 'haut de page' : 'bas de page');

      var ident = lireIdentite(form);
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = 'Envoi en cours…';

      fetch('https://api.web3forms.com/submit', { method: 'POST', body: data })
        .then(function (r) { return r.json(); })
        .then(function (json) {
          if (json.success) {
            form.reset();
            form.classList.add('is-sent');
            success.style.display = 'block';
            reportConversion('generate_lead', ident);
            success.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } else {
            error.style.display = 'block';
          }
        })
        .catch(function () { error.style.display = 'block'; })
        .finally(function () { btn.disabled = false; btn.textContent = label; });
    });
  });


  /* ---------- 6. Alignement de la page sur la requête tapée ----------
     Le visiteur arrive d'une annonce déclenchée par SA requête : la page doit
     lui renvoyer son propre besoin, pas un titre générique. On lit le terme de
     recherche transmis par l'annonce ({keyword} dans le suffixe d'URL), on en
     déduit l'intention et la commune, et on ajuste titre, sous-titre, formulaire.
     Sans paramètre, la page reste exactement telle qu'elle est écrite. */
  var terme = (src.mot_cle || params.get('kw') || '').toLowerCase();

  function sansAccents(s) {
    return s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  }

  function intention(q) {
    q = sansAccents(q);
    /* L'ordre compte : « prix desamiantage » doit tomber sur « prix », mais
       « urgence fuite » passe avant tout le reste. */
    /* « fuit » manquait : « toiture qui fuit » est un mot-clé du compte et
       tombait dans le générique au lieu de déclencher l'accroche d'urgence. */
    if (/\b(urgence|urgent|fuite|fuit|infiltration|depannage|tempete|bachage|sinistre|degat)\b/.test(q)) return 'urgence';
    if (/\b(prix|tarif|devis|cout|combien|estimation|budget|m2|au metre)\b/.test(q)) return 'prix';
    if (/\b(amiante|desamiantage|fibrociment|fibro|eternit)\b/.test(q)) return 'amiante';
    if (/\b(hydrofuge|hydrofugation|impermeabilisation|peinture toiture)\b/.test(q)) return 'hydro';
    if (/\b(gouttiere|goutiere|descente|chenau|cheneau|zinguerie|zingueur)\b/.test(q)) return 'gouttiere';
    if (/\b(facade|mur|crepi|enduit|ravalement|pignon)\b/.test(q)) return 'facade';
    if (/\b(charpente|poutre|fermette|solive|traitement bois)\b/.test(q)) return 'charpente';
    if (/\b(renovation|refection|refaire|changement|remplacement|neuve|remaniage)\b/.test(q)) return 'renovation';
    if (/\b(demoussage|anti mousse|antimousse|mousse|lichen|nettoyage|lavage)\b/.test(q)) return 'nettoyage';
    if (/\b(velux|fenetre de toit)\b/.test(q)) return 'velux';
    if (/\b(toit|toiture|couverture|ardoise|tuile)\b/.test(q)) return 'toiture';
    return '';
  }

  function communeDetectee(q) {
    var villes = window.LP_VILLES || [];
    q = sansAccents(q);
    for (var i = 0; i < villes.length; i++) {
      if (q.indexOf(sansAccents(villes[i]).toLowerCase()) !== -1) return villes[i];
    }
    return '';
  }

  if (terme) {
    var M = window.LP_MATCH || {};
    var intent = intention(terme);
    var variante = M[intent];
    var h1 = document.querySelector('.hero h1');
    var sub = document.querySelector('.hero-sub');

    if (variante && h1) {
      if (variante.h1) h1.innerHTML = variante.h1;
      if (variante.sub && sub) sub.textContent = variante.sub;
      /* Bandeau d'urgence : on pousse l'appel, pas le formulaire. */
      if (variante.urgent) {
        var band = document.createElement('a');
        band.className = 'lp-urgent';
        band.href = document.querySelector('a[href^="tel:"]').getAttribute('href');
        band.innerHTML = '<b>' + variante.urgent + '</b>';
        band.addEventListener('click', function () {
          dl.push({ event: 'phone_call', link_url: band.getAttribute('href'), form_location: LP });
          sendTo(window.ADS_CONVERSION_APPEL || window.ADS_CONVERSION || '');
        });
        h1.parentNode.insertBefore(band, h1.nextSibling);
      }
    }

    /* La commune tapée remplace la liste générique : « Couvreur à Bergerac »
       rassure plus que « Périgueux · Bergerac · Sarlat ». */
    var ville = communeDetectee(terme);
    if (ville) {
      var loc = document.querySelector('.hero-loc');
      if (loc) {
        var svg = loc.querySelector('svg');
        loc.textContent = '';
        if (svg) loc.appendChild(svg);
        loc.appendChild(document.createTextNode(' Intervention à ' + ville + ' et alentours'));
      }
      document.querySelectorAll('input[name="ville"]').forEach(function (el) {
        el.value = ville;
      });
    }

    /* Le besoin correspondant est pré-sélectionné : un champ de moins à remplir. */
    var libelle = (M.besoin || {})[intent];
    if (libelle) {
      document.querySelectorAll('select[name="besoin"]').forEach(function (sel) {
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text === libelle) { sel.selectedIndex = i; break; }
        }
      });
    }

    dl.push({ event: 'lp_match', intention: intent || 'aucune', commune: ville || 'aucune' });
  }

  /* ---------- 5. Année ---------- */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());


  /* ---------- 8. Bandeau de consentement (Consent Mode v2) ----------
     Le choix est mémorisé ; tant qu'il n'est pas fait, Google reste en mode
     refusé et modélise. Le bandeau ne masque jamais la barre d'appel. */
  (function () {
    var memo = null;
    try { memo = localStorage.getItem('vbr_consent'); } catch (e) {}
    if (memo === 'granted' || memo === 'denied') return;

    var el = document.createElement('div');
    el.className = 'cookiebar';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Gestion des cookies');
    el.innerHTML =
      '<p>Un cookie de mesure, pour savoir quelles annonces amènent de vraies demandes. Rien d\'autre.</p>' +
      '<div class="cookiebar-acts">' +
      '<button type="button" class="refuse">Refuser</button>' +
      '<button type="button" class="accept">Accepter</button>' +
      '</div>';
    document.body.appendChild(el);

    /* La hauteur doit être relue APRÈS le rendu des polices, sinon la barre
       d'appel remonte trop peu et le bandeau la recouvre. ResizeObserver suit
       la valeur réelle en continu ; le timer couvre les navigateurs sans. */
    function place() {
      document.documentElement.style.setProperty('--consent-h', (el.offsetHeight + 8) + 'px');
    }
    /* Surtout pas de requestAnimationFrame ici : dans un onglet ouvert en
       arrière-plan il ne se déclenche pas, et le bandeau ne s'afficherait
       jamais — donc aucun consentement possible, donc aucune conversion. */
    el.classList.add('is-open');
    document.body.classList.add('has-cookiebar');
    place();
    if (window.ResizeObserver) { new ResizeObserver(place).observe(el); }
    setTimeout(place, 250);
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(place); }
    window.addEventListener('resize', place);

    function choisir(ok) {
      try { localStorage.setItem('vbr_consent', ok ? 'granted' : 'denied'); } catch (e) {}
      if (typeof window.gtag === 'function') {
        window.gtag('consent', 'update', {
          ad_storage: ok ? 'granted' : 'denied',
          ad_user_data: ok ? 'granted' : 'denied',
          ad_personalization: ok ? 'granted' : 'denied',
          analytics_storage: ok ? 'granted' : 'denied'
        });
      }
      el.classList.remove('is-open');
      document.body.classList.remove('has-cookiebar');
      setTimeout(function () { el.remove(); }, 60);
    }
    el.querySelector('.accept').addEventListener('click', function () { choisir(true); });
    el.querySelector('.refuse').addEventListener('click', function () { choisir(false); });
  })();

})();
