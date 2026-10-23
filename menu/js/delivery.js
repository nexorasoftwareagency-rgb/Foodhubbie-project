function _renderComboOffers() {
    const section = document.getElementById('comboOffersSection');
    const grid = document.getElementById('comboOffersGrid');
    if (!section || !grid) return;
    const combos = (M.combos || []).filter(c => isComboActive(c, Date.now()) && _comboVisibleForCustomer(c));
    if (!combos.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    grid.className = 'combo-offers-grid';
    grid.innerHTML = combos.map(c => {
        const d = _comboData(c);
        const dishNames = d.entries.map(e => e.dish.name + ' x' + e.qty).join(', ');
        const comboDishIds = new Set(d.entries.map(e => e.dish.id));
        const crossSell = M.dishes.filter(d => !comboDishIds.has(d.id) && d.price && d.price <= 150).slice(0, 2).map(d => ({ id: d.id, name: d.name, price: d.price }));
        return '<div class="combo-card" data-combo-id="' + c.id + '">' +
            '<div class="combo-card-img">' +
            '<div class="combo-img-frame">' + (c.image ? '<img src="' + c.image + '" alt="' + esc(c.name) + '">' : '<div class="combo-placeholder">🏷️</div>') + '</div>' +
            '<div class="combo-img-scrim"></div>' +
            '<span class="combo-img-off">' + d.disc + '</span>' +
            '<span class="' + _comboVegMark(c) + '" aria-label="' + (_comboVegMark(c) === 'combo-veg' ? 'Veg' : 'Non-Veg') + '"></span>' +
            '</div>' +
            '<button class="combo-fab" data-action="addCombo" data-id="' + c.id + '">ADD</button>' +
            '<div class="combo-card-body">' +
            '<div class="combo-card-title">' + esc(c.name) + '</div>' +
            '<div class="combo-card-items">' + esc(dishNames) + '</div>' +
            '<div class="combo-card-price-row">' +
            '<span class="combo-card-orig">' + UI.fmtMoney(d.originalTotal) + '</span>' +
            '<span class="combo-card-price">' + UI.fmtMoney(d.comboPrice) + '</span>' +
            '<span class="combo-card-disc">' + d.disc + '</span>' +
            '<span class="combo-card-hint">Tap for details ›</span>' +
            '</div>' +
            '</div>' +
            '</div>';
    }).join('');
    if (!grid._cbListener) {
        grid._cbListener = true;
        grid.addEventListener('click', function(e) {
            const fab = e.target.closest('.combo-fab');
            if (fab) {
                fab.classList.add('combo-fab-added');
                fab.textContent = '✓';
                setTimeout(function() { fab.classList.remove('combo-fab-added'); fab.textContent = 'ADD'; }, 700);
                _addComboToCart(fab.getAttribute('data-id'));
                return;
            }
            const card = e.target.closest('.combo-card');
            if (!card) return;
            const combo = combos.find(function(c) { return c.id === card.getAttribute('data-combo-id'); });
            if (!combo) return;
            const cd = _comboData(combo);
            const comboDishIds = new Set(cd.entries.map(function(e) { return e.dish.id; }));
            const crossSell = M.dishes.filter(function(d) { return !comboDishIds.has(d.id) && d.price && d.price <= 150; }).slice(0, 2).map(function(d) { return { id: d.id, name: d.name, price: d.price }; });
            var comboSheetOptions = {
                name: combo.name,
                discLabel: cd.disc,
                saving: cd.saving,
                price: cd.comboPrice,
                rows: cd.entries.map(function(e, i) { return { dishId: e.dish.id, qty: e.qty, unitPrice: cd.prices[i] }; })
            };
            var onClose = function() { _addComboToCart(combo.id); };
            UI.showComboSheet(comboSheetOptions, onClose);
        });
    }
}