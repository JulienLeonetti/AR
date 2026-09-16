// Présentation et interactions du studio, indépendantes de la scène Three.js.
const byId = (id) => document.getElementById(id);
const cards = [...document.querySelectorAll('.ar-object')];
const panel = byId('mySidenav');
const help = byId('helpLayer');
let lastState = '';
let toastTimer;
let modal = null;
let previousFocus = null;

function setModal(element) {
    modal = element;
    document.querySelector('.topbar').inert = Boolean(element);
    document.querySelector('.studio').inert = Boolean(element);
    panel.inert = element === help;
}

export function closeCollection() {
    if (!document.body.classList.contains('collection-open')) return;
    document.body.classList.remove('collection-open');
    byId('drawerBackdrop').hidden = true;
    byId('menuButton').setAttribute('aria-expanded', 'false');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    setModal(null);
    byId('menuButton').focus({ preventScroll: true });
}

function openCollection() {
    document.body.classList.add('collection-open');
    byId('drawerBackdrop').hidden = false;
    byId('menuButton').setAttribute('aria-expanded', 'true');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    setModal(panel);
    byId('closeCollection').focus({ preventScroll: true });
}

function openHelp() {
    closeCollection();
    previousFocus = document.activeElement;
    help.hidden = false;
    setModal(help);
    byId('closeHelp').focus({ preventScroll: true });
}

function closeHelp() {
    help.hidden = true;
    setModal(null);
    previousFocus?.focus({ preventScroll: true });
}

export function setupInterface({ scale, resetView, deselect, exitAR }) {
    byId('menuButton').addEventListener('click', openCollection);
    byId('closeCollection').addEventListener('click', closeCollection);
    byId('drawerBackdrop').addEventListener('click', closeCollection);
    byId('helpButton').addEventListener('click', openHelp);
    for (const id of ['closeHelp', 'helpBackdrop', 'understoodButton']) {
        byId(id).addEventListener('click', closeHelp);
    }
    byId('resetViewButton').addEventListener('click', resetView);
    byId('shrinkButton').addEventListener('click', () => scale(1 / 1.1));
    byId('growButton').addEventListener('click', () => scale(1.1));
    byId('deselectButton').addEventListener('click', deselect);
    byId('exitARButton').addEventListener('click', exitAR);
    document.addEventListener('keydown', (event) => {
        if (!modal) return;
        if (event.key === 'Escape') {
            modal === help ? closeHelp() : closeCollection();
        }
        if (event.key !== 'Tab') return;
        const focusable = [...modal.querySelectorAll('button, a[href]')]
            .filter((element) => !element.disabled && element.getClientRects().length);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    });
}

export function notify(message) {
    clearTimeout(toastTimer);
    byId('toast').textContent = message;
    byId('toast').hidden = false;
    toastTimer = setTimeout(() => { byId('toast').hidden = true; }, 3000);
}

export function updateInterface(state) {
    const signature = JSON.stringify(state);
    if (signature === lastState) return;
    lastState = signature;
    const { model, ar, selected, count, scale, surface, loading, failed, hasObject } = state;
    document.body.classList.toggle('is-ar', ar);
    byId('modeLabel').textContent = ar ? 'Mode AR' : 'Studio 3D';
    for (const card of cards) {
        const active = card.id === model;
        card.classList.toggle('is-active', active);
        card.setAttribute('aria-pressed', String(active));
    }
    byId('objectName').textContent = byId(model)?.dataset.name || 'Votre objet';
    byId('objectMeta').textContent = selected ? 'À VOUS DE L’AJUSTER' : 'PIÈCE 0' + model + ' / 04';
    byId('modelState').classList.toggle('is-loading', loading);
    byId('modelStateText').textContent = failed ? 'Chargement impossible' : loading ? 'Chargement…' : selected ? 'Sélectionné' : hasObject ? 'Prêt à explorer' : 'Choisissez un objet';
    byId('placedCount').textContent = count + (count > 1 ? ' objets' : ' objet');
    byId('clearButton').disabled = count === 0;
    byId('selectionTools').hidden = !ar || !selected;
    byId('scaleValue').textContent = scale + ' %';
    byId('shrinkButton').disabled = scale <= 25;
    byId('growButton').disabled = scale >= 400;
    byId('placeLabel').textContent = selected ? 'DÉPLACER' : 'PLACE';
    byId('placeButton').setAttribute('aria-label', selected ? 'Déplacer l’objet sur la surface détectée' : 'Placer un objet sur la surface détectée');
    byId('arStatus').classList.toggle('surface-found', surface);
    byId('arStatusText').textContent = !surface ? 'Déplacez doucement le téléphone pour trouver une surface' : loading ? 'Surface détectée · Chargement de l’objet…' : !hasObject ? 'Surface détectée · Choisissez un objet' : selected ? 'Visez un endroit, puis appuyez sur DÉPLACER' : 'Surface détectée · Appuyez sur PLACE';
}

// ARButton conserve son fonctionnement WebXR ; seule sa présentation est adaptée.
export function decorateARButton(button) {
    byId('arEntry').appendChild(button);
    const labels = {
        'START AR': ['Voir dans mon espace', false],
        'STOP AR': ['Quitter l’AR', false],
        'AR NOT SUPPORTED': ['AR indisponible', true],
        'AR NOT ALLOWED': ['AR non autorisée', true],
        'WEBXR NOT AVAILABLE': ['AR indisponible', true],
        'WEBXR NEEDS HTTPS': ['Connexion HTTPS requise', true]
    };
    const translate = () => {
        const original = button.textContent.trim();
        const label = labels[original];
        if (!label) return;
        const [text, unavailable] = label;
        button.textContent = text;
        button.classList.toggle('ar-unavailable', unavailable);
        button.setAttribute('aria-label', text);
        if (button instanceof HTMLButtonElement) button.disabled = unavailable;
        if (unavailable) {
            byId('arAvailability').textContent = original === 'WEBXR NEEDS HTTPS'
                ? 'Ouvrez le site en HTTPS pour utiliser la caméra en AR.'
                : 'L’AR nécessite un téléphone et un navigateur compatibles.';
            button.title = byId('arAvailability').textContent;
            if (button instanceof HTMLAnchorElement) {
                button.removeAttribute('href');
                button.setAttribute('role', 'note');
            }
        }
    };
    new MutationObserver(translate).observe(button, { childList: true, characterData: true, subtree: true });
    translate();
}
