// ==UserScript==
// @name          Sakhmet Solitaire Autoplayer
// @namespace     GreaseMonkey
// @version       1.3
// @description   Autoplayer for Neopets Sakhmet Solitaire with adjustable delays ;)
// @author        @willnjohnson
// @match         *://www.neopets.com/games/sakhmet_solitaire/*
// @grant         none
// ==/UserScript==

// ─── CONSTANTS & DELAYS ──────────────────────────────────────────────────────
const FOUNDATION_TD_OFFSET = 4;
const TABLEAU_TD_OFFSET = 2;
const WASTE_TD_INDEX = 3;

function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const DELAY_CYAN = () => getRandomDelay(500, 600); // kinda fast delay
const DELAY_MAGENTA = () => getRandomDelay(800, 850); // kinda fast delay, but not as fast as cyan
const DELAY_GREEN = () => getRandomDelay(560, 650); // kinda fast delay, magenta implies user knows what move to make
const DELAY_COLLECT_WINNINGS = () => getRandomDelay(1400, 1800); // delay for Collect Winnings
const DELAY_PRE_POST_GAME = () => getRandomDelay(700, 900); // kinda fast for pre-game and post-game screens
const DELAY_RELOAD_PAGE = () => getRandomDelay(1000, 1500); // Delay before reloading page
const DELAY_GO_BACK = () => getRandomDelay(1050, 1800); // Delay before going back

let currentSuggestion = null;
let autoPlaying = true;

// State tracking for bug detection
let previousStateHash = null;
let preMoveStateHash = null;
let sameStateCount = 0;
let runAIInProgress = false;
const MAX_SAME_STATE = 1;

// ─── COOKIE FUNCTIONS ─────────────────────────────────────────────────────────
const COOKIE_NAME = 'neopets_solitaire_state';

function setCookieState(value) {
    document.cookie = COOKIE_NAME + '=' + encodeURIComponent(value) + '; path=/; max-age=3600';
}

function getCookieState() {
    return getCookie(COOKIE_NAME);
}

function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
}

// ─── STATE HASH ───────────────────────────────────────────────────────────────
function getStateHash() {
    const cardImgs = document.querySelectorAll('img[name^="card_"], img[src*="mcards/"], img[src*="sakhmet_solitaire/"]');
    let hash = '';
    cardImgs.forEach(img => {
        const name = img.getAttribute('name') || '';
        const src = img.src;
        const filename = src.split('/').pop();
        if (filename && filename !== 'transparent_spacer.gif' && filename !== 'new_blank_card.gif') {
            hash += name + '=' + filename + ',';
        }
    });
    return hash;
}

// ─── NAVIGATION HELPERS ───────────────────────────────────────────────────────
async function reloadPage() {
    console.log('No action could be taken. Reloading page...');
    await new Promise(resolve => setTimeout(resolve, DELAY_RELOAD_PAGE()));
    window.location.replace("https://www.neopets.com/games/sakhmet_solitaire/sakhmet_solitaire.phtml");
}

async function goBack() {
    console.log('Encountered an error page. Going back in history...');
    await new Promise(resolve => setTimeout(resolve, DELAY_GO_BACK()));
    window.history.back();
}

const getElement = (selector, context = document) => {
    try { return context.querySelector(selector); }
    catch (e) { return null; }
};

const SELECTORS = {
    errorMessageDiv: "div.errorMessage b",
};

async function checkForErrorMessage() {
    const errorBoldText = getElement(SELECTORS.errorMessageDiv);
    if (errorBoldText && errorBoldText.textContent.includes("Error: ") &&
        errorBoldText.closest("div.errorMessage").textContent.includes("You have been directed to this page from the wrong place!")) {
        console.warn('Detected "You have been directed to this page from the wrong place!" error.');
        await goBack();
        return true;
    }
    return false;
}

// ─── CARD CLASS ───────────────────────────────────────────────────────────────
class Card {
    constructor(rank, suit, faceUp) {
        if (rank !== undefined) {
            this.rank = rank;
            this.suit = suit;
            this.faceUp = faceUp !== undefined ? faceUp : false;
        } else {
            this.rank = 0;
            this.suit = 0;
            this.faceUp = false;
        }
    }

    static fromCard(old) { return new Card(old.rank, old.suit, old.faceUp); }

    getRank() { return this.rank; }
    getSuit() { return this.suit; }
    isFaceUp() { return this.faceUp; }
    isBlack() { return this.suit === 1 || this.suit === 4; }
    turnFaceUp() { this.faceUp = true; }
    turnFaceDown() { this.faceUp = false; }

    toString() {
        let s;
        switch (this.rank) {
            case 0: s = '?'; break;
            case 14: s = 'A'; break;
            case 11: s = 'J'; break;
            case 12: s = 'Q'; break;
            case 13: s = 'K'; break;
            default: s = this.rank.toString(); break;
        }
        const suitChars = ['', '\u2660', '\u2665', '\u2666', '\u2663'];
        s += suitChars[this.suit] || '?';
        return s;
    }

    clearCards() { this.rank = 0; this.suit = 0; }
}

// ─── PILE CLASS ───────────────────────────────────────────────────────────────
class Pile {
    constructor(newStock) {
        this.cardList = [];
        if (newStock) {
            Array.from({ length: 4 }, (_, suit) => suit + 1).forEach(suit =>
                Array.from({ length: 13 }, (_, rank) => rank + 1).forEach(rank =>
                    this.addToTop(new Card(rank, suit, false))
                )
            );
        }
    }

    static fromWaste(old) {
        const pile = new Pile();
        for (let i = 0; i < old.getNumCards(); i++) {
            pile.addToTop(Card.fromCard(old.getCard(i)));
        }
        return pile;
    }

    shuffle() {
        for (let i = this.cardList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cardList[i], this.cardList[j]] = [this.cardList[j], this.cardList[i]];
        }
    }

    addToTop(card) { this.cardList.push(card); }
    getCard(i) { return this.cardList[i]; }
    getNumCards() { return this.cardList.length; }
    isEmpty() { return this.cardList.length === 0; }
    getTopCard() { return this.cardList[this.cardList.length - 1]; }
    removeTopCard() { return this.cardList.pop(); }
    moveTopTo(dest) { dest.addToTop(this.removeTopCard()); }

    turnPileFaceDownTo(dest) {
        while (this.getNumCards() > 0) {
            this.moveTopTo(dest);
            dest.getTopCard().turnFaceDown();
        }
    }

    moveSubpileTo(index, dest) {
        while (this.getNumCards() > index) {
            dest.addToTop(this.cardList.splice(index, 1)[0]);
        }
    }
}

// ─── SOLITAIRE STATE CLASS ────────────────────────────────────────────────────
class SolitaireState {
    constructor(drawCount, maxPasses, old) {
        this.TOTAL_PILES = 13;
        this.STOCK_INDEX = 0;
        this.WASTE_INDEX = 1;
        this.FOUNDATION_INDEX = 2;
        this.TABLEAU_INDEX = 6;

        if (old) {
            this.pass = old.pass;
            this.gameEnded = old.gameEnded;
            this.maxPasses = old.maxPasses;
            this.drawCount = old.drawCount;
            this.pile = new Array(this.TOTAL_PILES);
            for (let i = 0; i < this.TOTAL_PILES; i++) {
                this.pile[i] = Pile.fromWaste(old.pile[i]);
            }
        } else {
            this.pass = 1;
            this.gameEnded = false;
            this.maxPasses = maxPasses;
            this.drawCount = drawCount;
            this.pile = Array.from({ length: this.TOTAL_PILES }, () => new Pile());
        }
    }

    isGameEnded() { return this.gameEnded; }
    getDrawCount() { return this.drawCount; }
    getMaxPasses() { return this.maxPasses; }
    getPass() { return this.pass; }
    stock() { return this.pile[this.STOCK_INDEX]; }
    waste() { return this.pile[this.WASTE_INDEX]; }
    foundation(i) { return this.pile[this.FOUNDATION_INDEX + i]; }
    tableau(i) { return this.pile[this.TABLEAU_INDEX + i]; }
    getWaste(i) { return this.pile[i]; }

    initGame() {
        this.pile[this.STOCK_INDEX] = new Pile(true);
        this.stock().shuffle();
        Array.from({ length: 7 }, (_, i) => {
            this.stock().moveTopTo(this.tableau(i));
            this.tableau(i).getTopCard().turnFaceUp();
            Array.from({ length: 7 - i - 1 }, (_, j) => this.stock().moveTopTo(this.tableau(j + i + 1)));
        });
    }

    isGameWon() {
        return Array.from({ length: 4 }, (_, i) => i + 2).every(i => this.pile[i].getNumCards() >= 13);
    }

    clearCardsFaceDown() {
        if (this.pass === 1) {
            Array.from({ length: this.stock().getNumCards() }, (_, i) => this.stock().getCard(i).clearCards());
        }
        Array.from({ length: this.TOTAL_PILES - this.TABLEAU_INDEX }, (_, i) =>
            Array.from({ length: this.tableau(i).getNumCards() }, (_, j) => {
                const card = this.tableau(i).getCard(j);
                if (!card.isFaceUp()) card.clearCards();
            })
        );
    }

    isInRange(num, low, high) { return low <= num && num <= high; }

    playerMoveCall(p1, p2, p3) {
        if (this.handleMoveToStock(p1, p2)) return true;
        if (this.handleMoveToWaste(p1, p2)) return true;
        if (this.handleMoveToFoundation(p1, p2)) return true;
        if (this.handleMoveToTableau(p1, p2, p3)) return true;
        if (this.handleMoveTurnTopCard(p1, p2)) return true;
        return false;
    }

    handleMoveToStock(src, dst) {
        if (dst === 0) {
            if (src !== 1) return false;
            if (this.waste().isEmpty()) return false;
            if (this.stock().isEmpty() && this.pass < this.maxPasses) {
                this.waste().turnPileFaceDownTo(this.stock());
                this.pass++;
                return true;
            }
        }
        return false;
    }

    handleMoveToWaste(src, dst) {
        if (dst === 1) {
            if (src !== 0) return false;
            if (this.stock().isEmpty()) return false;
            Array.from({ length: this.drawCount }, () => {
                if (!this.stock().isEmpty()) {
                    this.stock().moveTopTo(this.waste());
                    this.waste().getTopCard().turnFaceUp();
                }
            });
            return true;
        }
        return false;
    }

    handleMoveToFoundation(src, dst) {
        if (this.isInRange(dst, 2, 5)) {
            if (!(src === 1 || this.isInRange(src, 6, 12))) return false;
            if (this.pile[src].isEmpty()) return false;
            const card = this.pile[src].getTopCard();
            if (!card.isFaceUp()) return false;

            if (card.getRank() === 1 && this.pile[dst].isEmpty()) {
                this.pile[src].moveTopTo(this.pile[dst]);
                return true;
            }

            if (this.pile[dst].isEmpty()) return false;
            const destCard = this.pile[dst].getTopCard();
            if (card.getSuit() === destCard.getSuit() &&
                card.getRank() === destCard.getRank() + 1) {
                this.pile[src].moveTopTo(this.pile[dst]);
                return true;
            }
        }
        return false;
    }

    handleMoveToTableau(src, dst, idx) {
        if (this.isInRange(dst, 6, 12)) {
            if (src === 0 || src === dst) return false;
            if (this.pile[src].isEmpty()) return false;
            if (this.isInRange(src, 1, 5)) idx = this.pile[src].getNumCards() - 1;
            if (!this.isInRange(idx, 0, this.pile[src].getNumCards() - 1)) return false;
            const card = this.pile[src].getCard(idx);
            if (!card.isFaceUp()) return false;

            if (card.getRank() === 13 && this.pile[dst].isEmpty()) {
                this.pile[src].moveSubpileTo(idx, this.pile[dst]);
                return true;
            }

            if (this.pile[dst].isEmpty()) return false;
            const destCard = this.pile[dst].getTopCard();
            if (card.isBlack() !== destCard.isBlack() &&
                card.getRank() === destCard.getRank() - 1) {
                this.pile[src].moveSubpileTo(idx, this.pile[dst]);
                return true;
            }
        }
        return false;
    }

    handleMoveTurnTopCard(src, dst) {
        if (dst === src) {
            if (!this.isInRange(src, 6, 12)) return false;
            if (this.pile[src].isEmpty()) return false;
            if (this.pile[src].getTopCard().isFaceUp()) return false;
            this.pile[src].getTopCard().turnFaceUp();
            return true;
        }
        return false;
    }
}

// ─── HIGHLIGHT HELPERS ────────────────────────────────────────────────────────
function applyHighlight(element, color = 'magenta') {
    if (!element) return;
    element.style.border = `2px solid ${color}`;
    element.style.boxSizing = 'border-box';
    element.style.boxShadow = `${color} 0 0 12px 3px`;
}

function removeHighlight(element) {
    if (!element) return;
    element.style.border = '';
    element.style.boxShadow = '';
}

function clearAllHighlights() {
    document.querySelectorAll('img').forEach(img => removeHighlight(img));
}

// ─── CARD IMAGE LOOKUP ────────────────────────────────────────────────────────
function cardToFilename(cardStr) {
    const suitMap = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
    if (cardStr.length < 2) return null;

    let rank = cardStr.slice(0, -1);
    const suitSymbol = cardStr.slice(-1);
    const suit = suitMap[suitSymbol];
    if (!suit) {
        console.warn(`cardToFilename: Unknown suit symbol ${suitSymbol} for card ${cardStr}`);
        return null;
    }

    if (rank === 'A' || rank === '1') rank = '14';
    else if (rank === 'J') rank = '11';
    else if (rank === 'Q') rank = '12';
    else if (rank === 'K') rank = '13';

    return `${rank}_${suit}`;
}

function findCardImage(cardStr) {
    const filename = cardToFilename(cardStr);
    if (!filename) return null;

    for (const img of document.querySelectorAll('img[src*=".gif"]')) {
        const actualFilename = img.src.split('/').pop();
        if (actualFilename === `${filename}.gif`) return { element: img, isChosen: false };
        if (actualFilename === `${filename}_chosen.gif`) return { element: img, isChosen: true };
    }
    return null;
}

function getTableauColumnTd(colIndex) {
    const tableauRow = document.querySelector('table[cols="9"] tr:nth-child(2)');
    if (!tableauRow) return null;
    return tableauRow.querySelector(`td:nth-child(${colIndex + TABLEAU_TD_OFFSET})`);
}

function findDestinationElement(moveStr) {
    if (moveStr.includes('-> T')) {
        const tableauMatch = moveStr.match(/-> T(\d+)/);
        if (tableauMatch) {
            const tableauIndex = parseInt(tableauMatch[1]);
            const columnTd = getTableauColumnTd(tableauIndex);
            if (columnTd) {
                const img = columnTd.querySelector('img[src*="new_blank_card.gif"]');
                if (img) return img;
                console.warn(`findDestinationElement: Empty tableau slot image not found in column T${tableauIndex}.`);
            } else {
                console.warn(`findDestinationElement: Could not locate <td> for tableau column T${tableauIndex}.`);
            }
            return null;
        }
    }

    const foundMatch = moveStr.match(/^F(\d+)$/);
    if (foundMatch) {
        const foundIndex = parseInt(foundMatch[1]);
        const targetTd = document.querySelector(`td:nth-child(${foundIndex + FOUNDATION_TD_OFFSET})`);
        if (targetTd) {
            const emptyFoundImg = targetTd.querySelector(`img[src*="new_open.gif"]`);
            if (emptyFoundImg) return emptyFoundImg;
            console.warn(`findDestinationElement: Empty foundation img NOT found for F${foundIndex}. Highlighting TD.`);
            return targetTd;
        }
        console.warn(`findDestinationElement: TD for Foundation F${foundIndex} not found.`);
        return null;
    }

    const parts = moveStr.split('->');
    if (parts.length === 2) {
        const destPart = parts[1].trim();
        if (destPart.toLowerCase().startsWith('waste')) {
            return document.querySelector(`td:nth-child(${WASTE_TD_INDEX}) > a[onclick*="stack_0"] > img`);
        } else {
            const destCardStr = destPart.split(' ')[0];
            if (/^T\d+$/.test(destCardStr)) {
                const tableauIndex = parseInt(destCardStr.slice(1));
                const columnTd = getTableauColumnTd(tableauIndex);
                if (columnTd) {
                    const img = columnTd.querySelector('img[src*="new_blank_card.gif"]');
                    if (img) return img;
                }
                return null;
            } else if (/^F\d+$/.test(destCardStr)) {
                const foundIndex = parseInt(destCardStr.slice(1));
                const imgs = document.querySelectorAll('img[src*="new_open.gif"]');
                if (imgs.length > foundIndex) return imgs[foundIndex];
                return null;
            } else {
                const destResult = findCardImage(destCardStr);
                if (destResult) return destResult.element;
            }
        }
    }

    console.warn('findDestinationElement: Could not find destination element for:', moveStr);
    return null;
}

// ─── MOVE HIGHLIGHT & AUTO-CLICK ──────────────────────────────────────────────
function applyMoveHighlight(suggestion) {
    clearAllHighlights();

    if (suggestion.includes('Collect Winnings')) {
        if (autoPlaying) {
            setTimeout(() => {
                const collectForm = document.forms['sakhmet_collect'];
                if (collectForm) {
                    collectForm.submit();
                } else {
                    console.warn('AutoPlayer: Could not find Collect Winnings form');
                    reloadPage();
                }
            }, DELAY_COLLECT_WINNINGS());
        }
        return;
    }

    let highlightedElement = null;
    let delay = DELAY_MAGENTA();

    if (suggestion.includes('Draw')) {
        const drawPilePyramid = document.querySelector(`a[href*="action=draw"] img[src*="backs/pyramid.gif"]`);
        const drawPileRoundEnd = document.querySelector(`img[src*="new_round_end.gif"]`);

        if (drawPilePyramid) {
            applyHighlight(drawPilePyramid, 'cyan');
            highlightedElement = drawPilePyramid;
            delay = DELAY_CYAN();
        } else if (drawPileRoundEnd) {
            applyHighlight(drawPileRoundEnd, 'cyan');
            highlightedElement = drawPileRoundEnd;
            delay = DELAY_CYAN();
        }
    } else if (suggestion.includes('Flip top card')) {
        const tableauMatch = suggestion.match(/T(\d+)/);
        if (tableauMatch) {
            const colIndex = parseInt(tableauMatch[1]);
            const columnTd = document.querySelector(`tr:nth-child(2) > td:nth-child(${colIndex + TABLEAU_TD_OFFSET})`);
            if (columnTd) {
                const faceDownCards = columnTd.querySelectorAll('img[src*="backs/pyramid.gif"]');
                if (faceDownCards.length > 0) {
                    applyHighlight(faceDownCards[faceDownCards.length - 1], 'blue');
                    highlightedElement = faceDownCards[faceDownCards.length - 1];
                    delay = DELAY_GREEN();
                } else {
                    console.warn(`applyMoveHighlight: Could not find face-down card to flip in T${colIndex}`);
                }
            }
        }
    } else {
        const cardMoveMatch = suggestion.match(/(\d+)\)\s*([^->]+)\s*->\s*(.+)/);
        if (!cardMoveMatch) {
            console.warn("applyMoveHighlight: No card move pattern matched for suggestion:", suggestion);
            return;
        }

        const sourceCardStr = cardMoveMatch[2].trim();
        const sourceResult = findCardImage(sourceCardStr);
        if (!sourceResult) {
            console.warn("applyMoveHighlight: Could not find source card image for:", sourceCardStr, "in suggestion:", suggestion);
            return;
        }

        if (sourceResult.isChosen) {
            const destElement = findDestinationElement(suggestion);
            if (destElement) {
                applyHighlight(destElement, 'lime');
                highlightedElement = destElement;
                delay = DELAY_GREEN();
            } else {
                console.warn("applyMoveHighlight: Could not find destination element for:", suggestion);
            }
        } else {
            applyHighlight(sourceResult.element, 'magenta');
            highlightedElement = sourceResult.element;
            delay = DELAY_MAGENTA();
        }
    }

    if (highlightedElement && autoPlaying) {
        setTimeout(() => { highlightedElement.click(); }, delay);
    } else if (autoPlaying && !highlightedElement) {
        console.warn('AutoPlayer: Autoplay is ON, but no element was highlighted. Reloading as fallback.');
        reloadPage();
    }
}

// ─── GAME STATE PARSER ────────────────────────────────────────────────────────
function parseNeopetsSolitaire() {
    const solitaireState = new SolitaireState(3, 3);

    const backCounts = Array.from({ length: 7 }, (_, col) => {
        const columnAnchor = document.querySelector(`a[onclick*="column_${col}"]`);
        if (columnAnchor) {
            const backs = columnAnchor.parentElement.querySelectorAll('img[src*="backs/pyramid.gif"]');
            return backs.length;
        }
        return 0;
    }).reduce((acc, val, idx) => ({ ...acc, [idx]: val }), {});

    const imgs = document.querySelectorAll('img');
    const cardMap = {};
    const foundations = [];
    let wasteCard = null;

    imgs.forEach(img => {
        const src = img.src;
        let filename = null;
        const matchMcards = src.match(/\/games\/mcards\/([^\/]+)\.gif$/);
        const matchSolitaire = src.match(/\/games\/sakhmet_solitaire\/([^\/]+)\.gif$/);
        if (matchMcards) filename = matchMcards[1];
        else if (matchSolitaire) filename = matchSolitaire[1];
        if (!filename) return;

        if (filename === 'backs/pyramid') return;
        if (filename === 'new_open') return;

        const parts = filename.split('_');
        if (parts.length === 2) {
            let rank = parseInt(parts[0]);
            if (rank === 14) rank = 1;
            const suitStr = parts[1];
            let suit;
            switch (suitStr) {
                case 'spades': suit = 1; break;
                case 'hearts': suit = 2; break;
                case 'diamonds': suit = 3; break;
                case 'clubs': suit = 4; break;
                default:
                    console.warn(`parseNeopetsSolitaire: UNKNOWN SUIT for filename ${filename}. Skipping card.`);
                    return;
            }
            const card = new Card(rank, suit, true);

            const name = img.getAttribute('name') || '';
            const className = img.className || '';
            if (name.startsWith('card_')) {
                const [, col, idx] = name.split('_').map(Number);
                if (!cardMap[col]) cardMap[col] = {};
                cardMap[col][backCounts[col] + idx] = card;
            } else if (className.includes('deadcards')) {
                if (filename !== 'new_open') foundations.push(card);
            } else if (className.includes('deckcards')) {
                if (name) wasteCard = card;
            }
        }
    });

    if (wasteCard) solitaireState.waste().addToTop(wasteCard);

    Array.from({ length: 4 }, (_, i) => {
        if (foundations[i] && solitaireState.foundation(i).isEmpty()) {
            solitaireState.foundation(i).addToTop(foundations[i]);
        } else {
            const foundTd = document.querySelector(`td:nth-child(${FOUNDATION_TD_OFFSET + i})`);
            if (foundTd) {
                const img = foundTd.querySelector(`img[src*=".gif"]:not([src*="new_open.gif"])`);
                if (img) {
                    const filenameMatch = img.src.match(/\/games\/(mcards|sakhmet_solitaire)\/([^\/]+)\.gif$/);
                    if (filenameMatch) {
                        const fname = filenameMatch[2];
                        const fparts = fname.split('_');
                        if (fparts.length === 2) {
                            let rank = parseInt(fparts[0]);
                            if (rank === 14) rank = 1;
                            const suitMap = { 'spades': 1, 'hearts': 2, 'diamonds': 3, 'clubs': 4 };
                            const suit = suitMap[fparts[1]];
                            if (suit && solitaireState.foundation(i).isEmpty()) {
                                solitaireState.foundation(i).addToTop(new Card(rank, suit, true));
                            }
                        }
                    }
                }
            }
        }
    });

    Array.from({ length: 7 }, (_, col) => {
        Array.from({ length: backCounts[col] }, () =>
            solitaireState.tableau(col).addToTop(new Card(0, 0, false))
        );
        if (cardMap[col]) {
            Object.keys(cardMap[col]).map(Number).sort((a, b) => a - b).forEach(totalPileIndex => {
                if (cardMap[col][totalPileIndex]) {
                    solitaireState.tableau(col).addToTop(cardMap[col][totalPileIndex]);
                }
            });
        }
    });

    const visibleCount = Array.from({ length: solitaireState.TOTAL_PILES - 1 }, (_, i) =>
        solitaireState.pile[i + 1].getNumCards()
    ).reduce((sum, size) => sum + size, 0);
    const actualDeckSize = Math.max(0, 52 - visibleCount);
    Array.from({ length: actualDeckSize }, () => solitaireState.stock().addToTop(new Card()));

    const allTableEmpty = Array.from({ length: 7 }, (_, i) => solitaireState.tableau(i)).every(t => t.isEmpty());
    if (allTableEmpty && solitaireState.stock().isEmpty() && solitaireState.waste().isEmpty()) {
        solitaireState.gameEnded = true;
    }

    return solitaireState;
}

// ─── AI CLASS ─────────────────────────────────────────────────────────────────
class AI {
    constructor(cb) {
        this.callbacks = cb;
        this.madeMove = false;
        this.view = null;
    }

    askNextMove() {
        this.madeMove = false;
        this.game = this.callbacks.playerViewGame();

        this.checkTurnTableTopCardFaceUp();
        if (this.madeMove) return;

        this.checkMoveToFoundation();
        if (this.madeMove) return;

        this.checkMoveToTableau();
        if (this.madeMove) return;

        this.checkMoveSubpile();
        if (this.madeMove) return;

        this.checkDrawFromStock();
        if (this.madeMove) return;

        this.checkStartNewPass();
        if (this.madeMove) return;

        if (!this.madeMove) {
            console.log("AI: No valid moves found. Initiating page reload as a final fallback.");
            reloadPage();
        }
    }

    callMove(p1, p2, p3) {
        this.madeMove = true;
        return this.callbacks.playerMoveCall(p1, p2, p3);
    }

    checkStartNewPass() {
        if (this.madeMove) return;
        if (this.game.stock().isEmpty() && !this.game.waste().isEmpty() &&
            this.game.getPass() < this.game.getMaxPasses()) {
            this.callMove(1, 0, 0);
            return true;
        }
        return false;
    }

    checkDrawFromStock() {
        if (this.madeMove) return;
        if (!this.game.stock().isEmpty()) {
            this.callMove(0, 1, 0);
            return true;
        }
        return false;
    }

    checkTurnTableTopCardFaceUp() {
        if (this.madeMove) return false;
        return Array.from({ length: 7 }, (_, idx) => idx + 6).some(i => {
            const table = this.game.getWaste(i);
            const topCard = table.getTopCard();
            if (topCard && !topCard.isFaceUp()) {
                this.callMove(i, i, 0);
                return true;
            }
            return false;
        });
    }

    checkMoveToFoundFromPile(srcIdx) {
        if (this.madeMove) return false;
        const srcPile = this.game.getWaste(srcIdx);
        if (srcPile.isEmpty()) return false;
        const card = srcPile.getTopCard();
        if (!card || !card.isFaceUp()) return false;

        return Array.from({ length: 4 }, (_, idx) => idx + 2).some(j => {
            const dstPile = this.game.getWaste(j);
            if (dstPile.isEmpty()) {
                if (card.getRank() === 1) { this.callMove(srcIdx, j, 0); return true; }
                return false;
            }
            const destCard = dstPile.getTopCard();
            if (!destCard) return false;
            if (card.getSuit() === destCard.getSuit() && card.getRank() === destCard.getRank() + 1) {
                this.callMove(srcIdx, j, 0);
                return true;
            }
            return false;
        });
    }

    checkMoveToFoundation() {
        if (this.madeMove) return false;
        return Array.from({ length: 7 }, (_, idx) => idx + 6).some(i => this.checkMoveToFoundFromPile(i)) ||
            this.checkMoveToFoundFromPile(1);
    }

    checkMoveToTableFromPile(srcIdx) {
        if (this.madeMove) return;
        const srcPile = this.game.getWaste(srcIdx);
        if (srcPile.isEmpty()) return false;

        const faceIdx = (srcIdx === 1 ? srcPile.getNumCards() - 1 : this.idxFirstFaceUpCard(srcPile));
        if (faceIdx === -1 || faceIdx >= srcPile.getNumCards()) return false;

        const card = srcPile.getCard(faceIdx);
        if (!card || !card.isFaceUp()) return false;

        return Array.from({ length: 7 }, (_, idx) => idx + 6).some(j => {
            const dstPile = this.game.getWaste(j);
            if (dstPile.isEmpty()) {
                if (card.getRank() === 13 && (srcIdx === 1 || faceIdx > 0)) {
                    this.callMove(srcIdx, j, faceIdx);
                    return true;
                }
                return false;
            }
            const destCard = dstPile.getTopCard();
            if (!destCard) return false;
            if (card.isBlack() !== destCard.isBlack() && card.getRank() === destCard.getRank() - 1) {
                this.callMove(srcIdx, j, faceIdx);
                return true;
            }
            return false;
        });
    }

    checkMoveToTableau() {
        if (this.madeMove) return false;
        const numTables = this.game.TOTAL_PILES - this.game.TABLEAU_INDEX;
        const cardsDown = Array.from({ length: numTables }, (_, i) =>
            this.numFaceDownCards(this.game.getWaste(i + this.game.TABLEAU_INDEX))
        );
        const maxDown = Math.max(...cardsDown);

        for (let down = maxDown; down >= 0; down--) {
            for (let i = numTables - 1; i >= 0; i--) {
                if (cardsDown[i] === down) {
                    if (this.checkMoveToTableFromPile(i + this.game.TABLEAU_INDEX)) return true;
                }
            }
        }
        if (this.checkMoveToTableFromPile(1)) return true;
        return false;
    }

    checkMoveSubpile() {
        if (this.madeMove) return false;
        for (let i = 2; i <= 5; i++) {
            const foundPile = this.game.getWaste(i);
            if (foundPile.isEmpty()) continue;
            const topFoundationCard = foundPile.getTopCard();
            if (!topFoundationCard) continue;

            let ctrPile = -1, ctrIdx = -1;
            for (let j = 6; j <= 12; j++) {
                const dstPile = this.game.getWaste(j);
                if (dstPile.isEmpty()) continue;
                const topCard = dstPile.getTopCard();
                if (!topCard) continue;
                if (topCard.getSuit() !== topFoundationCard.getSuit() &&
                    topCard.isBlack() === topFoundationCard.isBlack() &&
                    topCard.getRank() === topFoundationCard.getRank() + 1) {
                    ctrIdx = dstPile.getNumCards() - 1;
                    ctrPile = j;
                    break;
                }
            }
            if (ctrPile === -1) continue;

            let matchPile = -1, matchIdx = -1;
            for (let j = 6; j <= 12; j++) {
                const srcPile = this.game.getWaste(j);
                if (srcPile.isEmpty()) continue;
                for (let k = 0; k < srcPile.getNumCards() - 1; k++) {
                    const nextCard = srcPile.getCard(k);
                    if (nextCard && nextCard.isFaceUp() &&
                        nextCard !== srcPile.getTopCard() &&
                        nextCard.getSuit() === topFoundationCard.getSuit() &&
                        nextCard.getRank() === topFoundationCard.getRank() + 1) {
                        matchPile = j;
                        matchIdx = k;
                        break;
                    }
                }
            }
            if (matchPile === -1) continue;

            this.callMove(matchPile, ctrPile, matchIdx + 1);
            return true;
        }
        return false;
    }

    idxFirstFaceUpCard(p) {
        return Array.from({ length: p.getNumCards() }, (_, i) => i).find(i => {
            const card = p.getCard(i);
            return card && card.isFaceUp();
        }) ?? -1;
    }

    numFaceDownCards(p) {
        if (p.isEmpty()) return 0;
        const topCard = p.getTopCard();
        if (!topCard || !topCard.isFaceUp()) return p.getNumCards();
        return this.idxFirstFaceUpCard(p);
    }
}

// ─── MOVE SUGGESTION STRING ───────────────────────────────────────────────────
function getMoveSuggestion(p1, p2, p3, solitaireState) {
    const srcPile = solitaireState.getWaste(p1);
    const dstPile = solitaireState.getWaste(p2);
    let srcIdx = p3;

    if (p1 >= 6 && p1 <= 12) {
        srcIdx = (p2 >= 6 && p2 <= 12) ? p3 : srcPile.getNumCards() - 1;
    } else if (p1 === 1 || (p1 >= 2 && p1 <= 5)) {
        srcIdx = srcPile.getNumCards() - 1;
    }
    const srcCard = srcPile.getCard(srcIdx);

    if (p1 === 0 && p2 === 1) {
        return "4) Draw";
    } else if (p1 === 1 && p2 === 0) {
        return "5) Collect Winnings";
    } else if (p2 >= 6 && p2 <= 12) {
        if (dstPile.isEmpty()) return `2) ${srcCard.toString()} -> T${p2 - 6}`;
        return `1) ${srcCard.toString()} -> ${dstPile.getTopCard().toString()}`;
    } else if (p2 >= 2 && p2 <= 5) {
        if (dstPile.isEmpty()) return `3) ${srcCard.toString()} -> F${p2 - 2}`;
        return `3) ${srcCard.toString()} -> ${dstPile.getTopCard().toString()} (F${p2 - 2})`;
    } else if (p2 === 1) {
        return `1) ${srcCard.toString()} -> Waste`;
    } else {
        return `Move: ${p1} -> ${p2}`;
    }
}

// ─── MAIN EXECUTION ───────────────────────────────────────────────────────────
(async function () {
    if (await checkForErrorMessage()) return;

    const playAgainButton = document.querySelector('input[value="Play Sakhmet Solitaire Again!"]');
    const playButton = document.querySelector('input[value="Play Sakhmet Solitaire!"]');

    if (playAgainButton) {
        console.log('Detected "Play Sakhmet Solitaire Again!" button - post-game state');
        if (autoPlaying) setTimeout(() => playAgainButton.click(), DELAY_PRE_POST_GAME());
        return;
    }

    if (playButton) {
        console.log('Detected "Play Sakhmet Solitaire!" button - pre-game state');
        if (autoPlaying) setTimeout(() => playButton.click(), DELAY_PRE_POST_GAME());
        return;
    }

    setTimeout(() => {
        const state = parseNeopetsSolitaire();
        if (!state) {
            console.error("Failed to parse game state. Helper cannot proceed.");
            reloadPage();
            return;
        }

        let currentSuggestion = null;

        const playerComputer = new AI({
            playerViewGame: () => state,
            playerMoveCall: (p1, p2, p3) => {
                let suggestion = getMoveSuggestion(p1, p2, p3, state);
                if (p1 === 0 && p2 === 1) {
                    const lastRoundText = document.body.innerText;
                    if (lastRoundText.includes('Last Round: 0') &&
                        document.querySelector('img[src*="new_empty.gif"]') !== null) {
                        suggestion = '5) Collect Winnings';
                    }
                }
                console.log('Suggested move:', suggestion);
                currentSuggestion = suggestion;
                applyMoveHighlight(suggestion);
                return true;
            }
        });

        const savedState = getCookieState();
        if (savedState) preMoveStateHash = savedState;

        runAI();

        function runAI() {
            if (runAIInProgress) return;
            runAIInProgress = true;

            try {
                const currentHash = getStateHash();

                if (preMoveStateHash && currentHash === preMoveStateHash) {
                    sameStateCount++;
                    if (sameStateCount >= MAX_SAME_STATE) {
                        console.log('Game appears stuck - attempting to collect winnings');
                        sameStateCount = 0;
                        preMoveStateHash = null;
                        previousStateHash = null;

                        const collectForm = document.forms['sakhmet_collect'];
                        if (collectForm) { collectForm.submit(); return; }
                        const collectBtn = document.querySelector('input[value*="Collect"]');
                        if (collectBtn) { collectBtn.click(); return; }
                        reloadPage();
                        return;
                    }
                } else {
                    sameStateCount = 0;
                }

                preMoveStateHash = currentHash;
                setCookieState(currentHash);
                playerComputer.askNextMove();
                previousStateHash = currentHash;
            } finally {
                runAIInProgress = false;
            }
        }

        const observer = new MutationObserver(mutations => {
            let shouldUpdate = false;
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                    if (mutation.target.src.includes('.gif')) shouldUpdate = true;
                }
            });
            if (shouldUpdate) setTimeout(runAI, 100);
        });

        observer.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ['src'],
            attributeOldValue: true
        });

    }, 50);
})();
