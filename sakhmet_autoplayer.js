// ==UserScript==
// @name          Sakhmet Solitaire Autoplayer
// @namespace     GreaseMonkey
// @version       1.1
// @description   Autoplayer for Neopets Sakhmet Solitaire with adjustable delays ;)
// @author        @willnjohnson
// @match         *://www.neopets.com/games/sakhmet_solitaire/*
// @grant         none
// ==/UserScript==

// Constants for DOM selectors
const FOUNDATION_TD_OFFSET = 4;
const TABLEAU_TD_OFFSET = 2;
const WASTE_TD_INDEX = 3;

// Configurable delays (in milliseconds) - now using ranges for variability
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
let autoPlaying = true; // Flag to control autoplay

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
    try {
        return context.querySelector(selector);
    } catch (e) {
        return null;
    }
};

const SELECTORS = {
    errorMessageDiv: "div.errorMessage b",
};

async function checkForErrorMessage() {
    const errorBoldText = getElement(SELECTORS.errorMessageDiv);
    if (errorBoldText && errorBoldText.textContent.includes("Error: ") && errorBoldText.closest("div.errorMessage").textContent.includes("You have been directed to this page from the wrong place!")) {
        console.warn('Detected "You have been directed to this page from the wrong place!" error.');
        await goBack();
        return true;
    }
    return false;
}

// Represents a playing card with rank, suit, and face-up status.
class Card {
    // Initializes a card with given rank, suit, and face-up status. If no parameters, creates an unknown card.
    constructor(rank, suit, faceUp) {
        if(rank !== undefined) {
            this.rank = rank; // Unknown = 0, A=1/14... J=11, Q=12, K=13
            this.suit = suit; // Unknown = 0, S=1, H=2, D=3, C=4
            this.faceUp = faceUp !== undefined ? faceUp : false;
        } else {
            // Unknown card
            this.rank = 0;
            this.suit = 0;
            this.faceUp = false;
        }
    }

    // Creates a copy of an existing card.
    static fromCard(old) {
        return new Card(old.rank, old.suit, old.faceUp);
    }

    // Returns the rank of the card.
    getRank() { return this.rank; }

    // Returns the suit of the card.
    getSuit() { return this.suit; }

    // Checks if the card is face up.
    isFaceUp() { return this.faceUp; }

    // Checks if the card is black (spades or clubs).
    isBlack() { return this.suit === 1 || this.suit === 4; }

    // Turns the card face up.
    turnFaceUp() { this.faceUp = true; }

    // Turns the card face down.
    turnFaceDown() { this.faceUp = false; } // Corrected to previous intent.

    // Returns a string representation of the card (e.g., "A♠").
    toString() {
        let s;
        switch(this.rank) {
            case 0:
                s = '?';
                break;
                // If internal rank is 1 for Ace, this will NOT be hit.
                // It means `default` will make it print '1', which `cardToFilename` MUST handle.
            case 14:
                s = 'A';
                break;
            case 11:
                s = 'J';
                break;
            case 12:
                s = 'Q';
                break;
            case 13:
                s = 'K';
                break;
            default:
                s = this.rank.toString();
                break;
        }
        const suitChars = ['', '\u2660', '\u2665', '\u2666', '\u2663']; // spade, heart, diamond, club
        s += suitChars[this.suit] || '?';
        return s;
    }

    // Clears the card's rank and suit, making it unknown.
    clearCards() {
        this.rank = 0;
        this.suit = 0;
    }
}

// Represents a collection of cards, like a deck or pile in solitaire.
class Pile {
    // Initializes a pile. If newStock is true, creates a full deck of 52 cards.
    constructor(newStock) {
        this.cardList = [];
        if(newStock) {
            Array.from({ length: 4 }, (_, suit) => suit + 1).forEach(suit =>
                Array.from({ length: 13 }, (_, rank) => rank + 1).forEach(rank =>
                    this.addToTop(new Card(rank, suit, false))
                )
            );
        }
    }

    // Creates a copy of an existing pile.
    static fromWaste(old) {
        const pile = new Pile();
        for(let i = 0; i < old.getNumCards(); i++) {
            pile.addToTop(Card.fromCard(old.getCard(i)));
        }
        return pile;
    }

    // Shuffles the cards in the pile randomly.
    shuffle() {
        for(let i = this.cardList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cardList[i], this.cardList[j]] = [this.cardList[j], this.cardList[i]];
        }
    }

    // Adds a card to the top of the pile.
    addToTop(card) { this.cardList.push(card); }

    // Gets the card at the specified index.
    getCard(i) { return this.cardList[i]; }

    // Returns the number of cards in the pile.
    getNumCards() { return this.cardList.length; }

    // Checks if the pile is empty.
    isEmpty() { return this.cardList.length === 0; }

    // Returns the top card without removing it.
    getTopCard() { return this.cardList[this.cardList.length - 1]; }

    // Removes and returns the top card.
    removeTopCard() { return this.cardList.pop(); }

    // Moves the top card to another pile.
    moveTopTo(dest) {
        dest.addToTop(this.removeTopCard());
    }

    // Moves all cards to another pile and turns them face down.
    turnPileFaceDownTo(dest) {
        while(this.getNumCards() > 0) {
            this.moveTopTo(dest);
            dest.getTopCard().turnFaceDown();
        }
    }

    // Moves a subpile from the specified index to another pile.
    moveSubpileTo(index, dest) {
        while(this.getNumCards() > index) {
            dest.addToTop(this.cardList.splice(index, 1)[0]);
        }
    }
}

// Represents the state of a solitaire game, including piles and game status.
class SolitaireState {
    // Initializes the game state. If old is provided, copies from it; otherwise, sets up a new game.
    constructor(drawCount, maxPasses, old) {
        this.TOTAL_PILES = 13;
        this.STOCK_INDEX = 0;
        this.WASTE_INDEX = 1;
        this.FOUNDATION_INDEX = 2;
        this.TABLEAU_INDEX = 6;

        if(old) {
            // Copy constructor
            this.pass = old.pass;
            this.gameEnded = old.gameEnded;
            this.maxPasses = old.maxPasses;
            this.drawCount = old.drawCount;
            this.pile = new Array(this.TOTAL_PILES);
            for(let i = 0; i < this.TOTAL_PILES; i++) {
                this.pile[i] = Pile.fromWaste(old.pile[i]);
            }
        } else {
            // New game
            this.pass = 1;
            this.gameEnded = false;
            this.maxPasses = maxPasses;
            this.drawCount = drawCount;
            this.pile = Array.from({ length: this.TOTAL_PILES }, () => new Pile());
        }
    }

    // Checks if the game has ended.
    isGameEnded() { return this.gameEnded; }

    // Returns the number of cards drawn per turn.
    getDrawCount() { return this.drawCount; }

    // Returns the maximum number of passes allowed.
    getMaxPasses() { return this.maxPasses; }

    // Returns the current pass number.
    getPass() { return this.pass; }

    // Returns the stock pile.
    stock() { return this.pile[this.STOCK_INDEX]; }

    // Returns the waste pile.
    waste() { return this.pile[this.WASTE_INDEX]; }

    // Returns the foundation pile at index i.
    foundation(i) { return this.pile[this.FOUNDATION_INDEX + i]; }

    // Returns the tableau pile at index i.
    tableau(i) { return this.pile[this.TABLEAU_INDEX + i]; }

    // Returns the pile at index i.
    getWaste(i) { return this.pile[i]; }

    // Initializes the game by shuffling the deck and dealing cards to tableau.
    initGame() {
        this.pile[this.STOCK_INDEX] = new Pile(true);
        this.stock().shuffle();
        Array.from({ length: 7 }, (_, i) => {
            this.stock().moveTopTo(this.tableau(i));
            this.tableau(i).getTopCard().turnFaceUp();
            Array.from({ length: 7 - i - 1 }, (_, j) => this.stock().moveTopTo(this.tableau(j + i + 1)));
        });
    }

    // Checks if the game is won by verifying all foundations have 13 cards.
    isGameWon() {
        return Array.from({ length: 4 }, (_, i) => i + 2).every(i => this.pile[i].getNumCards() >= 13);
    }

    // Clears unknown cards that are face down in the stock and tableau.
    clearCardsFaceDown() {
        // On first pass, scrub cards face-down in deck
        if(this.pass === 1) {
            Array.from({ length: this.stock().getNumCards() }, (_, i) => this.stock().getCard(i).clearCards());
        }

        // On any pass, scrub cards face-down in tables
        Array.from({ length: this.TOTAL_PILES - this.TABLEAU_INDEX }, (_, i) =>
            Array.from({ length: this.tableau(i).getNumCards() }, (_, j) => {
                const card = this.tableau(i).getCard(j);
                if(!card.isFaceUp()) {
                    card.clearCards();
                }
            })
        );
    }

    // Checks if a number is within a specified range.
    isInRange(num, low, high) {
        return low <= num && num <= high;
    }

    // Attempts to execute a move and returns true if successful.
    playerMoveCall(p1, p2, p3) {
        if(this.handleMoveToStock(p1, p2)) return true;
        if(this.handleMoveToWaste(p1, p2)) return true;
        if(this.handleMoveToFoundation(p1, p2)) return true;
        if(this.handleMoveToTableau(p1, p2, p3)) return true;
        if(this.handleMoveTurnTopCard(p1, p2)) return true;
        return false;
    }

    // Handles moving cards back to stock from waste when recycling.
    handleMoveToStock(src, dst) {
        if(dst === 0) {
            if(src !== 1) return false;
            if(this.waste().isEmpty()) return false;
            if(this.stock().isEmpty() && this.pass < this.maxPasses) {
                this.waste().turnPileFaceDownTo(this.stock());
                this.pass++;
                return true;
            }
        }
        return false;
    }

    // Handles drawing cards from stock to waste.
    handleMoveToWaste(src, dst) {
        if(dst === 1) {
            if(src !== 0) return false;
            if(this.stock().isEmpty()) return false;
            Array.from({ length: this.drawCount }, () => {
                if(!this.stock().isEmpty()) {
                    this.stock().moveTopTo(this.waste());
                    this.waste().getTopCard().turnFaceUp();
                }
            });
            return true;
        }
        return false;
    }

    // Handles moving cards to foundation piles.
    handleMoveToFoundation(src, dst) {
        if(this.isInRange(dst, 2, 5)) {
            if(!(src === 1 || this.isInRange(src, 6, 12))) return false;
            if(this.pile[src].isEmpty()) return false;
            const card = this.pile[src].getTopCard();
            if(!card.isFaceUp()) return false;

            // Ace to empty foundation
            if(card.getRank() === 1 && this.pile[dst].isEmpty()) {
                this.pile[src].moveTopTo(this.pile[dst]);
                return true;
            }

            // Same suit, one more rank
            if(this.pile[dst].isEmpty()) return false;
            const destCard = this.pile[dst].getTopCard();
            if(card.getSuit() === destCard.getSuit() &&
                card.getRank() === destCard.getRank() + 1) {
                this.pile[src].moveTopTo(this.pile[dst]);
                return true;
            }
        }
        return false;
    }

    // Handles moving cards or subpiles to tableau piles.
    handleMoveToTableau(src, dst, idx) {
        if(this.isInRange(dst, 6, 12)) {
            if(src === 0 || src === dst) return false;
            if(this.pile[src].isEmpty()) return false;
            if(this.isInRange(src, 1, 5)) idx = this.pile[src].getNumCards() - 1; // one card
            if(!this.isInRange(idx, 0, this.pile[src].getNumCards() - 1)) return false;
            const card = this.pile[src].getCard(idx);
            if(!card.isFaceUp()) return false;

            // King to empty tableau
            if(card.getRank() === 13 && this.pile[dst].isEmpty()) {
                this.pile[src].moveSubpileTo(idx, this.pile[dst]);
                return true;
            }

            // Reverse color, one less rank
            if(this.pile[dst].isEmpty()) return false;
            const destCard = this.pile[dst].getTopCard();
            if(card.isBlack() !== destCard.isBlack() &&
                card.getRank() === destCard.getRank() - 1) {
                this.pile[src].moveSubpileTo(idx, this.pile[dst]);
                return true;
            }
        }
        return false;
    }

    // Handles turning the top card of a tableau pile face up.
    handleMoveTurnTopCard(src, dst) {
        if(dst === src) {
            if(!this.isInRange(src, 6, 12)) return false;
            if(this.pile[src].isEmpty()) return false;
            if(this.pile[src].getTopCard().isFaceUp()) return false;
            this.pile[src].getTopCard().turnFaceUp();
            return true;
        }
        return false;
    }

}

// Applies a highlight border and glow to an element.
function applyHighlight(element, color = 'magenta') {
    if(!element) return;
    element.style.border = `2px solid ${color}`;
    element.style.boxSizing = 'border-box';
    element.style.boxShadow = `${color} 0 0 12px 3px`;
}

// Removes highlight from an element.
function removeHighlight(element) {
    if(!element) return;
    element.style.border = '';
    element.style.boxShadow = '';
}

// Removes highlights from all image elements.
function clearAllHighlights() {
    const allImages = document.querySelectorAll('img');
    allImages.forEach(img => removeHighlight(img));
}

// Convert card string to filename
// MODIFIED: To correctly map '1' or 'A' (from toString() output) to '14' for filenames.
function cardToFilename(cardStr) {
    const suitMap = {
        '♠': 'spades',
        '♥': 'hearts',
        '♦': 'diamonds',
        '♣': 'clubs'
    };

    if(cardStr.length < 2) return null;

    let rank = cardStr.slice(0, -1);
    const suitSymbol = cardStr.slice(-1);
    const suit = suitMap[suitSymbol];

    if(!suit) {
        console.warn(`cardToFilename: Unknown suit symbol ${suitSymbol} for card ${cardStr}`);
        return null;
    }

    // FIX: Handle '1' (from toString() output for Ace) or 'A' (if toString() was changed)
    // Neopets filenames use '14' for Ace.
    if(rank === 'A' || rank === '1') rank = '14';
    else if(rank === 'J') rank = '11';
    else if(rank === 'Q') rank = '12';
    else if(rank === 'K') rank = '13';

    return `${rank}_${suit}`;
}

// Find card image element
// MODIFIED: Simplified as `cardToFilename` is now authoritative for Ace '14'.
function findCardImage(cardStr) {
    const filename = cardToFilename(cardStr);
    if(!filename) {
        // console.log('findCardImage: Could not convert card to filename:', cardStr);
        return null;
    }

    // console.log('findCardImage: Looking for card:', cardStr, '-> filename:', filename);

    const allImages = document.querySelectorAll('img[src*=".gif"]');

    for(const img of allImages) {
        const src = img.src;
        const urlParts = src.split('/');
        const actualFilename = urlParts[urlParts.length - 1]; // e.g., '14_spades.gif'

        // Check for exact match with regular card
        if(actualFilename === `${filename}.gif`) {
            // console.log('findCardImage: Found regular card:', img.src);
            return { element: img, isChosen: false };
        }

        // Check for exact match with chosen card
        if(actualFilename === `${filename}_chosen.gif`) {
            // console.log('findCardImage: Found chosen card:', img.src);
            return { element: img, isChosen: true };
        }
    }

    // Removed the previous '14_' fallback, as cardToFilename should now directly give '14_' for Ace.
    // This simplifies logic and avoids unnecessary checks if cardToFilename is robust.

    // console.log('findCardImage: COULD NOT FIND any image for card:', cardStr, 'with filename:', filename);
    return null;
}

// Find destination element based on move type

function findDestinationElement(moveStr) {
    // Check for Tableau moves (T)
    if(moveStr.includes('-> T')) {
        const tableauMatch = moveStr.match(/-> T(\d+)/);
        if(tableauMatch) {
            const tableauIndex = parseInt(tableauMatch[1]);
            // Attempt to find an empty tableau slot if applicable (e.g., King to empty slot)
            const img = document.querySelector('img[src*="new_blank_card.gif"]');
            if(img) {
                // console.log('findDestinationElement: Found blank card for empty tableau T' + tableauIndex);
                return img;
            } else {
                return null;
            }
        }
    }
    // Check for Foundation moves (F)
    const foundMatch = moveStr.match(/^F(\d+)$/); // Matches exactly "F0", "F1", etc.
    if(foundMatch) {
        const foundIndex = parseInt(foundMatch[1]);
        const targetTd = document.querySelector(`td:nth-child(${foundIndex + FOUNDATION_TD_OFFSET})`);

        // console.log(`findDestinationElement: Checking for empty Foundation F${foundIndex}. Found TD:`, targetTd);

        if(targetTd) {
            const emptyFoundImg = targetTd.querySelector(`img[src*="new_open.gif"]`);
            if(emptyFoundImg) {
                // console.log('findDestinationElement: FOUND EMPTY FOUNDATION SLOT F' + foundIndex, emptyFoundImg);
                return emptyFoundImg; // FOUND AND RETURNED, NO FALLTHROUGH
            } else {
                // Similar to tableau, if new_open.gif isn't there but AI suggested empty F#, highlight TD.
                console.warn(`findDestinationElement: Empty foundation img NOT found for F${foundIndex}. Highlighting entire TD instead. TD InnerHTML:`, targetTd.innerHTML);
                return targetTd; // Highlight the TD itself
            }
        }
        console.warn(`findDestinationElement: TD for Foundation F${foundIndex} not found.`);
        return null;
    }

    // Generic card-to-card move or to Waste Pile
    const parts = moveStr.split('->');
    if(parts.length === 2) {
        const destPart = parts[1].trim();
        if(destPart.toLowerCase().startsWith('waste')) {
            const wastePileImg = document.querySelector(`td:nth-child(${WASTE_TD_INDEX}) > a[onclick*="stack_0"] > img`);
            if(wastePileImg) {
                // console.log('findDestinationElement: Found Waste Pile image.');
                return wastePileImg;
            }
        } else {
            // For card-to-card, find the destination card's image
            const destCardStr = destPart.split(' ')[0]; // Extract just the card string, e.g., "3♦"
            if(/^T\d+$/.test(destCardStr)) {
                // Handle empty tableau
                const imgs = document.querySelectorAll('img[src*="new_blank_card.gif"]');
                if(imgs.length > 0) {
                    // console.log('findDestinationElement: Found empty tableau image for:', destCardStr);
                    return imgs[0]; // Assume only one empty tableau
                }
                return null;
            } else if(/^F\d+$/.test(destCardStr)) {
                // Handle empty foundation
                const foundIndex = parseInt(destCardStr.slice(1));
                const imgs = document.querySelectorAll('img[src*="new_open.gif"]');
                if(imgs.length > foundIndex) {
                    // console.log('findDestinationElement: Found empty foundation image for:', destCardStr);
                    return imgs[foundIndex];
                }
                return null;
            } else {
                const destResult = findCardImage(destCardStr);
                if(destResult) return destResult.element;
            }
        }
    }

    console.warn('findDestinationElement: Could not find destination element for:', moveStr);
    return null;
}

// Applies highlighting based on the current move suggestion and schedules auto-click.
function applyMoveHighlight(suggestion) {
    clearAllHighlights(); // Always clear previous highlights first

    // If the suggestion is "Collect Winnings", handle separately
    if(suggestion.includes('Collect Winnings')) {
        if(autoPlaying) {
            setTimeout(() => {
                const collectForm = document.forms['sakhmet_collect'];
                if(collectForm) {
                    collectForm.submit();
                } else {
                    console.warn('AutoPlayer: Could not find Collect Winnings form');
                    // NEW: Fallback for Collect Winnings if form not found
                    reloadPage();
                }
            }, DELAY_COLLECT_WINNINGS());
        }
        return;
    }

    let highlightedElement = null;
    let delay = DELAY_MAGENTA(); // default

    if(suggestion.includes('Draw')) {
        const drawPilePyramid = document.querySelector(`a[href*="action=draw"] img[src*="backs/pyramid.gif"]`);
        const drawPileRoundEnd = document.querySelector(`img[src*="new_round_end.gif"]`);

        if(drawPilePyramid) {
            applyHighlight(drawPilePyramid, 'cyan');
            highlightedElement = drawPilePyramid;
            delay = DELAY_CYAN();
        } else if(drawPileRoundEnd) {
            applyHighlight(drawPileRoundEnd, 'cyan');
            highlightedElement = drawPileRoundEnd;
            delay = DELAY_CYAN();
        }
    } else if(suggestion.includes('Flip top card')) {
        const tableauMatch = suggestion.match(/T(\d+)/);
        if(tableauMatch) {
            const colIndex = parseInt(tableauMatch[1]);
            const columnTd = document.querySelector(`tr:nth-child(2) > td:nth-child(${colIndex + TABLEAU_TD_OFFSET})`);
            if(columnTd) {
                const faceDownCards = columnTd.querySelectorAll('img[src*="backs/pyramid.gif"]');
                if(faceDownCards.length > 0) {
                    applyHighlight(faceDownCards[faceDownCards.length - 1], 'blue');
                    highlightedElement = faceDownCards[faceDownCards.length - 1];
                    delay = DELAY_GREEN(); // medium-fast for flip
                } else {
                    console.warn(`applyMoveHighlight: Could not find face-down card to flip in T${colIndex}`);
                }
            }
        }
    } else {
        // Parse generic card move (e.g., "1) 2♠ -> 3♦")
        const cardMoveMatch = suggestion.match(/(\d+)\)\s*([^->]+)\s*->\s*(.+)/);
        if(!cardMoveMatch) {
            console.warn("applyMoveHighlight: No card move pattern matched for suggestion:", suggestion);
            return;
        }

        const sourceCardStr = cardMoveMatch[2].trim();
        const destStr = cardMoveMatch[3].trim();

        const sourceResult = findCardImage(sourceCardStr);
        if(!sourceResult) {
            console.warn("applyMoveHighlight: Could not find source card image for:", sourceCardStr, "in suggestion:", suggestion);
            return;
        }

        if(sourceResult.isChosen) {
            // Source card is already chosen. Attempting to highlight destination.
            const destElement = findDestinationElement(suggestion);
            if(destElement) {
                applyHighlight(destElement, 'lime');
                highlightedElement = destElement;
                delay = DELAY_GREEN(); // medium-fast for destination
            } else {
                console.warn("applyMoveHighlight: Could not find destination element for:", suggestion);
            }
        } else {
            // Source card is not chosen. Highlighting source.
            applyHighlight(sourceResult.element, 'magenta');
            highlightedElement = sourceResult.element;
            delay = DELAY_MAGENTA();
        }
    }

    // Schedule auto-click if element is highlighted and autoPlaying is on
    if(highlightedElement && autoPlaying) {
        setTimeout(() => {
            highlightedElement.click();
        }, delay);
    }
    // NEW: Fallback if autoPlaying but no element was highlighted
    else if (autoPlaying && !highlightedElement) {
        console.warn('AutoPlayer: Autoplay is ON, but no element was highlighted for the suggested move. Reloading as fallback.');
        reloadPage();
    }
}

// Parses the current Neopets solitaire game state from the DOM.
function parseNeopetsSolitaire() {
    const solitaireState = new SolitaireState(3, 3); // Assume 3 cards drawn, 3 passes

    // Get back counts for each column
    const backCounts = Array.from({ length: 7 }, (_, col) => {
        const columnAnchor = document.querySelector(`a[onclick*="column_${col}"]`);
        if(columnAnchor) {
            const columnDiv = columnAnchor.parentElement;
            const backs = columnDiv.querySelectorAll('img[src*="backs/pyramid.gif"]');
            return backs.length;
        } else {
            return 0;
        }
    }).reduce((acc, val, idx) => ({ ...acc, [idx]: val }), {});

    // Parse cards from img tags
    const imgs = document.querySelectorAll('img');
    const cardMap = {}; // Maps {col_index: {total_stack_index: Card_object}}
    const foundations = []; // Temporarily collect foundation cards
    let wasteCard = null;

    imgs.forEach(img => {
        const src = img.src;
        let filename = null;
        const matchMcards = src.match(/\/games\/mcards\/([^\/]+)\.gif$/);
        const matchSolitaire = src.match(/\/games\/sakhmet_solitaire\/([^\/]+)\.gif$/);
        if(matchMcards) {
            filename = matchMcards[1];
        } else if(matchSolitaire) {
            filename = matchSolitaire[1];
        }
        if(!filename) return;

        if(filename === 'backs/pyramid') return; // Stock back
        if(filename === 'new_open') return; // Empty foundation

        const parts = filename.split('_');
        // Reverted to original logic (length === 2) that was working
        if(parts.length === 2) {
            let rank = parseInt(parts[0]);
            if(rank === 14) rank = 1; // Treat 14 as A
            const suitStr = parts[1];
            let suit;
            switch(suitStr) {
                case 'spades':
                    suit = 1;
                    break;
                case 'hearts':
                    suit = 2;
                    break;
                case 'diamonds':
                    suit = 3;
                    break;
                case 'clubs':
                    suit = 4;
                    break;
                default:
                    console.warn(`parseNeopetsSolitaire: UNKNOWN SUIT for filename ${filename}. Skipping card.`);
                    return;
            }
            const card = new Card(rank, suit, true); // Assume face up for visible

            // Determine pile
            const name = img.getAttribute('name') || '';
            const className = img.className || '';
            if(name.startsWith('card_')) {
                // Tableau cards (e.g., name="card_0_0")
                const [, col, idx] = name.split('_').map(Number);
                if(!cardMap[col]) cardMap[col] = {};
                cardMap[col][backCounts[col] + idx] = card; // Place card after backs
            } else if(className.includes('deadcards')) {
                // Foundations (e.g., new_open.gif or existing card on a foundation)
                // If it's an actual card (not new_open), add it.
                if(filename !== 'new_open') {
                    foundations.push(card);
                }
            } else if(className.includes('deckcards')) {
                // Cards in the deck/waste area. Waste card has a 'name'.
                if(name) { // Has a name (e.g., "8_clubs") -> Waste pile card
                    wasteCard = card;
                } else { // No name (might be foundation, but better to parse explicitly below)
                    // Original code pushed to foundations here. Let's rely on explicit foundation parsing below.
                }
            }
        }
    });

    // Add waste card to SolitaireState
    if(wasteCard) {
        solitaireState.waste().addToTop(wasteCard);
    }

    // Add foundations in order (The order they are found in the `foundations` array is assumed to match F0, F1, F2, F3)
    // A more robust way might be explicit DOM targeting for each foundation slot.
    Array.from({ length: 4 }, (_, i) => {
        // Double-check if a foundation card already exists at this index.
        // This is important if `imgs.forEach` found them out of order, or we want to overwrite with specific HTML queries.
        if(foundations[i] && solitaireState.foundation(i).isEmpty()) {
            solitaireState.foundation(i).addToTop(foundations[i]);
        } else {
            // Explicitly look for foundation cards via their td position to be safer.
            const foundTd = document.querySelector(`td:nth-child(${FOUNDATION_TD_OFFSET + i})`);
            if(foundTd) {
                const img = foundTd.querySelector(`img[src*=".gif"]:not([src*="new_open.gif"])`);
                if(img) {
                    const filenameMatch = img.src.match(/\/games\/(mcards|sakhmet_solitaire)\/([^\/]+)\.gif$/);
                    if(filenameMatch) {
                        const filename = filenameMatch[2];
                        // Reverted to original logic (length === 2) that was working
                        const parts = filename.split('_');
                        if(parts.length === 2) {
                            let rank = parseInt(parts[0]);
                            if(rank === 14) rank = 1;
                            const suitStr = parts[1];
                            const suitMap = { 'spades': 1, 'hearts': 2, 'diamonds': 3, 'clubs': 4 };
                            const suit = suitMap[suitStr];
                            if(suit && solitaireState.foundation(i).isEmpty()) { // Only add if it's still empty
                                solitaireState.foundation(i).addToTop(new Card(rank, suit, true));
                            }
                        }
                    }
                }
            }
        }
    });


    // Add tableau cards
    Array.from({ length: 7 }, (_, col) => {
        // Add face down cards (unknown) based on backCounts
        Array.from({ length: backCounts[col] }, () => solitaireState.tableau(col).addToTop(new Card(0, 0, false))); // Face down

        // Add face up cards from cardMap in order
        if(cardMap[col]) {
            Object.keys(cardMap[col])
                .map(Number)
                .sort((a, b) => a - b)
                .forEach(totalPileIndex => {
                    if(cardMap[col][totalPileIndex]) {
                        solitaireState.tableau(col).addToTop(cardMap[col][totalPileIndex]);
                    }
                });
        }
    });

    // Count visible cards to estimate deck
    const visibleCount = Array.from({ length: solitaireState.TOTAL_PILES - 1 }, (_, i) => solitaireState.pile[i + 1].getNumCards()).reduce((sum, size) => sum + size, 0);
    const deckSize = 52 - visibleCount;
    // Safety check for deckSize
    const actualDeckSize = Math.max(0, deckSize);

    Array.from({ length: actualDeckSize }, () => solitaireState.stock().addToTop(new Card())); // Unknown cards

    // Check if game is won (all tableaux empty and deck empty)
    const allTableEmpty = Array.from({ length: 7 }, (_, i) => solitaireState.tableau(i)).every(table => table.isEmpty());
    if(allTableEmpty && solitaireState.stock().isEmpty() && solitaireState.waste().isEmpty()) {
        solitaireState.gameEnded = true;
    }

    return solitaireState;
}

// AI player that determines the next move in the solitaire game.
class AI {
    // Initializes the AI player with callbacks for game interaction.
    constructor(cb) {
        this.callbacks = cb;
        this.madeMove = false;
        this.view = null;
    }

    // Determines and executes the next move in the game.
    // Reverted to non-async to match working version, will handle reload as final fallback.
    askNextMove() {
        this.madeMove = false;
        this.game = this.callbacks.playerViewGame();

        this.checkTurnTableTopCardFaceUp();
        // If a move was made, stop checking. Added check.
        if(this.madeMove) return;

        this.checkMoveToFoundation();
        if(this.madeMove) return;

        this.checkMoveToTableau();
        if(this.madeMove) return;

        this.checkMoveSubpile();
        if(this.madeMove) return;

        this.checkDrawFromStock();
        if(this.madeMove) return;

        this.checkStartNewPass();
        if(this.madeMove) return;

        // NEW: Final fallback to reload page if no move could be made
        if (!this.madeMove) {
            console.log("AI: No valid moves found. Initiating page reload as a final fallback.");
            reloadPage(); // Call the async reloadPage function
        }
    }

    // Executes a move and marks it as made.
    callMove(p1, p2, p3) {
        this.madeMove = true;
        return this.callbacks.playerMoveCall(p1, p2, p3);
    }

    // Checks if a new pass should be started by recycling the waste to stock.
    checkStartNewPass() {
        if(this.madeMove) return;
        if(this.game.stock().isEmpty() && !this.game.waste().isEmpty() &&
            this.game.getPass() < this.game.getMaxPasses()) {
            this.callMove(1, 0, 0);
            return true; // Indicate move made
        }
        return false;
    }

    // Checks if cards should be drawn from the stock to waste.
    checkDrawFromStock() {
        if(this.madeMove) return;
        if(!this.game.stock().isEmpty()) {
            this.callMove(0, 1, 0);
            return true; // Indicate move made
        }
        return false;
    }

    // Checks if the top card of any tableau pile should be turned face up.
    checkTurnTableTopCardFaceUp() {
        if(this.madeMove) return false;
        return Array.from({ length: 7 }, (_, idx) => idx + 6).some(i => {
            const table = this.game.getWaste(i);
            const topCard = table.getTopCard(); // Added safety
            if(topCard && !topCard.isFaceUp()) { // Check topCard exists
                this.callMove(i, i, 0);
                return true; // Indicate move made
            }
            return false;
        });
    }

    // Checks if a card from a pile can be moved to a foundation.
    checkMoveToFoundFromPile(srcIdx) {
        if(this.madeMove) return false;
        const srcPile = this.game.getWaste(srcIdx);
        if(srcPile.isEmpty()) return false;
        const card = srcPile.getTopCard();

        if(!card || !card.isFaceUp()) return false; // Safety check

        return Array.from({ length: 4 }, (_, idx) => idx + 2).some(j => {
            const dstPile = this.game.getWaste(j);

            if(dstPile.isEmpty()) {
                if(card.getRank() === 1) {
                    this.callMove(srcIdx, j, 0);
                    return true;
                }
                return false;
            }

            const destCard = dstPile.getTopCard();
            if(!destCard) return false; // Safety check
            if(card.getSuit() === destCard.getSuit() &&
                card.getRank() === destCard.getRank() + 1) {
                this.callMove(srcIdx, j, 0);
                return true;
            }
            return false;
        });
    }

    checkMoveToFoundation() { // Wrapper to allow early exit
        if(this.madeMove) return false;
        return Array.from({ length: 7 }, (_, idx) => idx + 6).some(i => this.checkMoveToFoundFromPile(i)) ||
            this.checkMoveToFoundFromPile(1); // From waste
    }


    // Checks if a card or subpile from a pile can be moved to a tableau.
    checkMoveToTableFromPile(srcIdx) {
        if(this.madeMove) return;
        const srcPile = this.game.getWaste(srcIdx);
        if(srcPile.isEmpty()) return false;

        const faceIdx = (srcIdx === 1 ? srcPile.getNumCards() - 1 : this.idxFirstFaceUpCard(srcPile));

        if(faceIdx === -1 || faceIdx >= srcPile.getNumCards()) return false; // Safety check if no movable face-up card

        const card = srcPile.getCard(faceIdx);
        if(!card || !card.isFaceUp()) return false; // Safety check for card existence and face-up status

        return Array.from({ length: 7 }, (_, idx) => idx + 6).some(j => {
            const dstPile = this.game.getWaste(j);

            if(dstPile.isEmpty()) {
                if(card.getRank() === 13 &&
                    (srcIdx === 1 || faceIdx > 0)) { // King to empty tableau if it's not the *only* face-up card in a tableau source (and from waste is fine)
                    this.callMove(srcIdx, j, faceIdx);
                    return true;
                }
                return false;
            }

            const destCard = dstPile.getTopCard();
            if(!destCard) return false; // Safety check
            if(card.isBlack() !== destCard.isBlack() &&
                card.getRank() === destCard.getRank() - 1) {
                this.callMove(srcIdx, j, faceIdx);
                return true;
            }
            return false;
        });
        return false;
    }

    checkMoveToTableau() { // Wrapper to allow early exit
        if(this.madeMove) return false;

        const numTables = this.game.TOTAL_PILES - this.game.TABLEAU_INDEX;
        const cardsDown = Array.from({ length: numTables }, (_, i) => this.numFaceDownCards(this.game.getWaste(i + this.game.TABLEAU_INDEX)));
        const maxDown = Math.max(...cardsDown);

        for(let down = maxDown; down >= 0; down--) {
            for(let i = numTables - 1; i >= 0; i--) {
                if(cardsDown[i] === down) {
                    if(this.checkMoveToTableFromPile(i + this.game.TABLEAU_INDEX)) return true;
                }
            }
        }
        if(this.checkMoveToTableFromPile(1)) return true;
        return false;
    }


    // Checks for complex subpile moves involving foundations and tableaux.
    checkMoveSubpile() {
        if(this.madeMove) return false;
        for(let i = 2; i <= 5; i++) {
            const foundPile = this.game.getWaste(i);
            if(foundPile.isEmpty()) continue;
            const topFoundationCard = foundPile.getTopCard();
            if(!topFoundationCard) continue;

            let ctrPile = -1,
                ctrIdx = -1;
            for(let j = 6; j <= 12; j++) {
                const dstPile = this.game.getWaste(j);
                if(dstPile.isEmpty()) continue;
                const topCard = dstPile.getTopCard();
                if(!topCard) continue;

                if(topCard.getSuit() !== topFoundationCard.getSuit() &&
                    topCard.isBlack() === topFoundationCard.isBlack() &&
                    topCard.getRank() === topFoundationCard.getRank() + 1) {
                    ctrIdx = dstPile.getNumCards() - 1;
                    ctrPile = j;
                    break;
                }
            }
            if(ctrPile === -1) continue;

            let matchPile = -1,
                matchIdx = -1;
            for(let j = 6; j <= 12; j++) {
                const srcPile = this.game.getWaste(j);
                if(srcPile.isEmpty()) continue;
                for(let k = 0; k < srcPile.getNumCards() - 1; k++) { // Loop until the card before the top card
                    const nextCard = srcPile.getCard(k);
                    if(nextCard && nextCard.isFaceUp() &&
                        nextCard !== srcPile.getTopCard() &&
                        nextCard.getSuit() === topFoundationCard.getSuit() &&
                        nextCard.getRank() === topFoundationCard.getRank() + 1) {
                        matchPile = j;
                        matchIdx = k;
                        break;
                    }
                }
            }
            if(matchPile === -1) continue;

            this.callMove(matchPile, ctrPile, matchIdx + 1);
            return true;
        }
        return false;
    }


    // Finds the index of the first face-up card in a pile.
    idxFirstFaceUpCard(p) {
        return Array.from({ length: p.getNumCards() }, (_, i) => i).find(i => {
            const card = p.getCard(i);
            return card && card.isFaceUp();
        }) ?? -1;
    }

    // Counts the number of face-down cards in a pile.
    numFaceDownCards(p) {
        if(p.isEmpty()) return 0;

        const topCard = p.getTopCard();
        if(!topCard || !topCard.isFaceUp()) return p.getNumCards();
        return this.idxFirstFaceUpCard(p);
    }
}

// Generates a human-readable suggestion string for a move.
function getMoveSuggestion(p1, p2, p3, solitaireState) {
    const srcPile = solitaireState.getWaste(p1);
    const dstPile = solitaireState.getWaste(p2);
    let srcIdx = p3;
    if(p1 >= 6 && p1 <= 12) {
        // For tableau
        if(p2 >= 6 && p2 <= 12) {
            // Move to table, use p3
            srcIdx = p3;
        } else {
            // Move to found or other, use top card
            srcIdx = srcPile.getNumCards() - 1;
        }
    } else if(p1 === 1 || (p1 >= 2 && p1 <= 5)) {
        // Waste or foundation
        srcIdx = srcPile.getNumCards() - 1;
    }
    const srcCard = srcPile.getCard(srcIdx);

    if(p1 === 0 && p2 === 1) {
        return "4) Draw";
    } else if(p1 === 1 && p2 === 0) {
        return "5) Collect Winnings"; // Reverted to original phrasing for consistency with how AI was trained
    } else if(p2 >= 6 && p2 <= 12) { // To Tableau
        if(dstPile.isEmpty()) {
            return `2) ${srcCard.toString()} -> T${p2 - 6}`;
        } else {
            const dstCard = dstPile.getTopCard();
            return `1) ${srcCard.toString()} -> ${dstCard.toString()}`;
        }
    } else if(p2 >= 2 && p2 <= 5) { // To Foundation
        if(dstPile.isEmpty()) {
            return `3) ${srcCard.toString()} -> F${p2 - 2}`;
        } else {
            const dstCard = dstPile.getTopCard();
            return `3) ${srcCard.toString()} -> ${dstCard.toString()} (F${p2 - 2})`;
        }
    } else if(p2 === 1) { // To Waste
        return `1) ${srcCard.toString()} -> Waste`;
    } else {
        return `Move: ${p1} -> ${p2}`;
    }
}

// Main script execution: parses the game state and sets up the AI and highlighting.
(async function() { // Keep this async for checkForErrorMessage at the start
    // NEW: Check for and handle error messages immediately
    if (await checkForErrorMessage()) {
        return; // Stop script execution if an error was found and handled
    }

    // Check for pre-game or post-game states
    const playAgainButton = document.querySelector('input[value="Play Sakhmet Solitaire Again!"]');
    const playButton = document.querySelector('input[value="Play Sakhmet Solitaire!"]');
    // Removed the explicit 'sakhmet_collect' form check here.
    // The previous working code didn't have it, relying on AI to suggest 'Collect Winnings'.

    if(playAgainButton) {
        console.log('Detected "Play Sakhmet Solitaire Again!" button - Game is in post-game state');
        if(autoPlaying) {
            setTimeout(() => {
                playAgainButton.click();
            }, DELAY_PRE_POST_GAME());
        }
        return;
    }

    if(playButton) {
        console.log('Detected "Play Sakhmet Solitaire!" button - Game is in pre-game state');
        if(autoPlaying) {
            setTimeout(() => {
                playButton.click();
            }, DELAY_PRE_POST_GAME());
        }
        return;
    }

    // Delay parsing to ensure page is fully loaded
    setTimeout(() => { // Reverted to non-async for consistency with working version
        const state = parseNeopetsSolitaire();
        if(!state) { // Added safety check
            console.error("Failed to parse game state. Helper cannot proceed.");
            // NEW: Fallback if initial state parsing fails
            reloadPage();
            return;
        }


        let currentSuggestion = null; // Initialize currentSuggestion

        // Suggest move
        const playerComputer = new AI({
            playerViewGame: () => state,
            playerMoveCall: (p1, p2, p3) => {
                let suggestion = getMoveSuggestion(p1, p2, p3, state);
                // Special check for Draw when game is won
                if(p1 === 0 && p2 === 1) {
                    const lastRoundText = document.body.innerText;
                    const hasLastRound0 = lastRoundText.includes('Last Round: 0');
                    const hasNewEmpty = document.querySelector('img[src*="new_empty.gif"]') !== null;
                    if(hasLastRound0 && hasNewEmpty) {
                        suggestion = '5) Collect Winnings';
                    }
                }
                console.log('Suggested move:', suggestion);
                currentSuggestion = suggestion; // Store the suggestion globally

                // Apply highlighting based on the suggestion
                applyMoveHighlight(suggestion);

                return true; // Assume move is valid for the purpose of getting suggestion
            }
        });

        // Reverted to non-async call to askNextMove
        playerComputer.askNextMove();

        // Function to run the AI and apply highlights
        const runAI = () => { // Reverted to non-async for consistency with working version
            playerComputer.askNextMove();
        };

        // MutationObserver for dynamic highlighting and re-running AI
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            mutations.forEach((mutation) => {
                if(mutation.type === 'attributes' && mutation.attributeName === 'src') {
                    const img = mutation.target;
                    // Check if a card image's src changed (indicating game state change)
                    if(img.src.includes('.gif')) {
                        shouldUpdate = true;
                    }
                }
            });

            if(shouldUpdate) {
                // Re-run AI after a short delay to allow page updates
                setTimeout(runAI, 100);
            }
        });

        observer.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ['src'],
            attributeOldValue: true // Needed to check old src value
        });

    }, 50);
})();
