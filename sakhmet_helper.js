// ==UserScript==
// @name          Sakhmet Solitaire Helper
// @namespace     GreaseMonkey
// @version       Sakhmet Solitaire Helper [v. Alpha 1.0]
// @description   A basic Solitaire solver that shows available moves.
//                Mostly vibe-coded, so there's probably code smell and bugs.
// @match         *://www.neopets.com/games/sakhmet_solitaire/*
// @author        @willnjohnson
// @grant         none
// ==/UserScript==

(function () {
    'use strict';

    // Helper to get the actual image element for a given tableau card location
    function getTableauCardImg(col, row) {
        const anchor = document.querySelector(`a[onclick*="column_${col}','${row}']`);
        return anchor ? anchor.querySelector('img') : null;
    }

    // Helper to get the image element for a given foundation base
    function getFoundationBaseImg(baseIndex) {
        return document.querySelector(`a[onclick*="base_${baseIndex}"] img`);
    }

    // Helper to get the image element for the wastepile (discard pile)
    function getWastepileImg() {
        return document.querySelector('a[href^="javascript:;"][onclick*="stack_0"] img');
    }

    // Helper to get the *img* element for the stockpile (draw pile)
    function getStockpileImg() {
        const anchor = document.querySelector('a[href="sakhmet_solitaire.phtml?action=draw"]');
        return anchor ? anchor.querySelector('img') : null;
    }

    // Helper to get the "End Round / New Round" button element
    function getRoundEndButton() {
        const roundEndImg = document.querySelector('img[src*="new_round_end.gif"]');
        if (roundEndImg) {
            const anchor = roundEndImg.closest('a'); // Get the parent anchor
            if (anchor) {
                return {
                    img: roundEndImg, // The image element
                    anchor: anchor,    // The clickable anchor element
                    type: 'round_end_button',
                    description: 'End Round / New Round'
                };
            }
        }
        return null;
    }

    // Modified cardCodeFromURL to return an object for easier internal logic
    // IMPORTANT: Redefined Ace to value 1 for consistent ascending foundation logic.
    function cardCodeFromURL(url) {
        let chosen = false;
        let cleanUrl = url;

        if (url.includes('_chosen.gif')) {
            chosen = true;
            cleanUrl = cleanUrl.replace('_chosen.gif', '.gif');
        }

        const match = cleanUrl.match(/\/(\d+)_([a-z]+)\.gif/);
        if (!match) {
            if (cleanUrl.includes("backs/pyramid.gif")) return { value: '?', suit: '?', chosen: chosen, type: 'facedown' };
            if (cleanUrl.includes("new_open.gif")) return { value: '?', suit: '?', chosen: chosen, type: 'empty_foundation' };
            // A new blank card (e.g. for empty tableau columns that are not kings)
            if (cleanUrl.includes("new_blank_card.gif")) return { value: '?', suit: '?', chosen: chosen, type: 'empty_tableau' };
            if (cleanUrl.includes("new_round_end.gif")) return { value: '?', suit: '?', chosen: chosen, type: 'round_end_button_img' }; // Added for completeness, though getRoundEndButton handles it.
            return { value: '?', suit: '?', chosen: chosen, type: 'unknown' };
        }

        let value = parseInt(match[1]);
        let suit = match[2][0].toUpperCase();

        // Remap Ace from 14 to 1 for consistent ascending logic for for foundations
        if (value === 14) value = 1; // Ace
        // J, Q, K remain 11, 12, 13 respectively
        return { value: value, suit: suit, chosen: chosen, type: 'playable' };
    }

    // Helper to convert internal card object back to string for display
    function cardToString(card) {
        if (!card || card.value === '?') return '?';
        let valStr = card.value;
        if (card.value === 1) valStr = 'A'; // Display Ace as 'A'
        else if (card.value === 11) valStr = 'J';
        else if (card.value === 12) valStr = 'Q';
        else if (card.value === 13) valStr = 'K';
        return valStr + card.suit;
    }

    function isRed(suit) {
        return suit === 'H' || suit === 'D';
    }

    function isBlack(suit) {
        return suit === 'C' || suit === 'S';
    }

    function parseDrawsRemaining() {
        const text = [...document.querySelectorAll("td.medText")].find(td => td.textContent.includes("First Round") || td.textContent.includes("Second Round") || td.textContent.includes("Last Round"));
        if (!text) return 0; // If no round text, assume 0 draws remaining.
        const match = text.textContent.match(/(First|Second|Last) Round:\s*(\d+)/);
        if (match) {
            return parseInt(match[2]) * 4; // Multiplied by 4 because each round is 4 passes of the deck
        }
        return 0; // If text is present but doesn't match the pattern (e.g., "No cards left.").
    }

    function parseWastepile() {
        const wasteImg = getWastepileImg();
        const cardInfo = wasteImg ? cardCodeFromURL(wasteImg.src) : null;
        if (cardInfo) {
            return [{ img: wasteImg, ...cardInfo, type: 'wastepile_card' }];
        }
        return [];
    }

    function parseFoundations() {
        const foundationsData = [];
        for (let i = 0; i <= 3; i++) {
            const img = getFoundationBaseImg(i);
            const cardInfo = img ? cardCodeFromURL(img.src) : null;
            foundationsData.push(cardInfo && cardInfo.type !== 'empty_foundation' ? { img: img, ...cardInfo } : { img: img, value: '?', suit: '?', chosen: false, type: 'empty_foundation' });
        }
        return foundationsData;
    }

    // UPDATED: Added more height options to the div selector for more robust tableau parsing.
    function parseTableauForSolver() {
        const tableauData = {};
        for (let col = 0; col <= 6; col++) { // 'col' here directly corresponds to the visual column
            // Look for divs with specific heights or a generic overflow hidden
            const div = document.querySelector(`td:nth-child(${col + 2}) > div[style*="height:290px"], td:nth-child(${col + 2}) > div[style*="height:353px"], td:nth-child(${col + 2}) > div[style*="height:374px"], td:nth-child(${col + 2}) > div[style*="overflow:hidden"]`);
            if (!div) {
                tableauData[`col${col}`] = [];
                continue;
            }

            const cardsInColumn = [];
            // Get all img elements in the column to determine their fullStackIndex (for facedown checks)
            const allImgElementsInColumn = [...div.querySelectorAll('img[src*="mcards"], img[src*="pyramid.gif"], img[src*="new_blank_card"]')];

            // Filter for only playable cards and add their fullStackIndex
            const clickableAnchors = [...div.querySelectorAll(`a[onclick*="column_${col}"]`)];

            clickableAnchors.forEach(anchor => {
                const img = anchor.querySelector('img');
                if (img) {
                    const cardInfo = cardCodeFromURL(img.src);
                    // Include empty_tableau for accurate targeting of empty columns that have a placeholder image
                    if (cardInfo.type === 'playable' || cardInfo.type === 'empty_tableau') {
                        const fullStackIndex = allImgElementsInColumn.findIndex(el => el === img);

                        const actualCol = col;

                        // The 3rd parameter in Neopets' onclick (e.g., 'column_0', '1', '0', '1') is the 'column_number'
                        // The 4th parameter is the 'row_in_game_logic' (not visual offset)
                        const onclickMatch = anchor.onclick.toString().match(/'column_(\d+)',\s*'(\d+)',\s*'(\d+)',\s*'(\d+)'/);
                        const actualRow = onclickMatch ? parseInt(onclickMatch[3]) : 0;

                        cardsInColumn.push({ img: img, col: actualCol, row: actualRow, fullStackIndex: fullStackIndex, ...cardInfo });
                    }
                }
            });
            tableauData[`col${col}`] = cardsInColumn;
        }
        return tableauData;
    }

    // UPDATED: Added more height options to the div selector for more robust tableau parsing.
    function parseFullTableauForLogging() {
        const fullTableauData = {};
        for (let col = 0; col <= 6; col++) {
            // Look for divs with specific heights or a generic overflow hidden
            const div = document.querySelector(`td:nth-child(${col + 2}) > div[style*="height:290px"], td:nth-child(${col + 2}) > div[style*="height:353px"], td:nth-child(${col + 2}) > div[style*="height:374px"], td:nth-child(${col + 2}) > div[style*="overflow:hidden"]`);
            if (!div) {
                fullTableauData[`col${col}`] = [];
                continue;
            }

            const cardsInColumn = [];
            const imgElements = [...div.querySelectorAll('img[src*="mcards"], img[src*="pyramid.gif"], img[src*="new_blank_card"]')];

            // Iterate through images in the order they appear visually in the HTML
            for (const img of imgElements) {
                const cardInfo = cardCodeFromURL(img.src);
                cardsInColumn.push(cardToString(cardInfo));
            }
            fullTableauData[`col${col}`] = cardsInColumn;
        }
        return fullTableauData;
    }

    // NEW: Function to count facedown cards *above* a specific index in a column
    // `bottomCardOfMovingStackFullStackIndex`: The `fullStackIndex` of the bottom-most card of the stack being moved.
    // `fullColumnSnapshot`: The array from `parseFullTableauForLogging` for this specific column (used for '?' checks).
    // Returns the count of facedown cards that would be revealed.
    function countFacedownsAbove(bottomCardOfMovingStackFullStackIndex, fullColumnSnapshot) {
        let facedownCount = 0;
        // Iterate upwards from the card *immediately above* the moved stack
        for (let i = bottomCardOfMovingStackFullStackIndex - 1; i >= 0; i--) {
            if (fullColumnSnapshot[i] === '?') {
                facedownCount++;
            } else {
                // Stop counting once a face-up card (or empty placeholder) is encountered
                break;
            }
        }
        return facedownCount;
    }

    function applyHighlight(element, color = 'magenta') {
        if (!element) return;
        element.style.border = `2px solid ${color}`;
        element.style.boxSizing = 'border-box';
        element.style.boxShadow = `${color} 0 0 12px 3px`;
    }

    // REFINED clearAllHighlights
    function clearAllHighlights() {
        // Select all img elements that represent cards (playable, facedown, empty foundation, empty tableau)
        // and also the stockpile anchor (the "draw" area) and the round end button image.
        document.querySelectorAll(
            'img.deckcards, ' +          // Common class for many card images
            'img.deadcards, ' +          // Common class for discarded cards (like new_blank_card.gif or new_round_end.gif)
            'img[src*="pyramid.gif"], ' + // Facedown cards
            'img[src*="new_open.gif"], ' + // Empty foundation slots
            'img[src*="new_blank_card.gif"], ' + // Empty tableau column placeholder
            'img[src*="mcards"], ' + // Card images with 'mcards' in src (e.g., in /mcards/ directory)
            'img[src*="new_round_end.gif"], ' + // New: Round End button image
            'a[href="sakhmet_solitaire.phtml?action=draw"] img' // Stockpile image (target the img inside the anchor)
        ).forEach(el => {
            el.style.border = '';
            el.style.boxShadow = '';
        });
    }

    function setGameBackground(color = 'darkgreen') {
        document.querySelectorAll('tr').forEach(row => {
            if (row.style.backgroundImage.includes('sakhmet_solitaire_bg.png') || row.style.backgroundColor === 'darkgreen' || row.getAttribute('bgcolor') === 'darkgreen' || row.style.backgroundColor === 'orange' || row.getAttribute('bgcolor') === 'orange' || row.style.backgroundColor === 'red' || row.getAttribute('bgcolor') === 'red' || row.style.backgroundColor === 'darkred' || row.getAttribute('bgcolor') === 'darkred') {
                row.style.backgroundImage = 'none';
                row.style.backgroundColor = color;
                row.setAttribute('bgcolor', color);
            }
        });
    }

    // Global variables for game state and history
    let lastKnownGameState = JSON.parse(localStorage.getItem('sakhmetSolitaire_lastGameState')) || null;
    let moveHistory = JSON.parse(localStorage.getItem('sakhmetSolitaire_moveHistory')) || [];
    const MAX_HISTORY_LENGTH = 4; // To detect A->B, B->A, A->B, B->A cycles (requires 4 moves)

    // Function to capture a snapshot of the current game state
    function getGameStateSnapshot() {
        const wastepile = parseWastepile();
        const foundations = parseFoundations();
        const tableau = parseTableauForSolver(); // This includes 'chosen' status and 'img' elements
        const stockpile_count = parseDrawsRemaining();

        let chosenCardInfo = null;
        if (wastepile.length > 0 && wastepile[0].chosen) {
            chosenCardInfo = wastepile[0];
        } else {
            for (const colKey in tableau) {
                const columnCards = tableau[colKey];
                for (const card of columnCards) {
                    if (card.chosen) {
                        chosenCardInfo = card;
                        break;
                    }
                }
                if (chosenCardInfo) break;
            }
        }

        // We only need a 'data' representation of the state for comparison, not the DOM elements
        const snapshot = {
            wastepile: wastepile.length > 0 ? cardToString(wastepile[0]) : null,
            foundations: foundations.map(f => cardToString(f)),
            tableauTops: Object.keys(tableau).map(colKey => {
                const col = tableau[colKey];
                return col.length > 0 ? cardToString(col[col.length - 1]) : 'empty';
            }),
            stockpile: stockpile_count,
            chosenCard: chosenCardInfo ? cardToString(chosenCardInfo) : null
        };
        return JSON.stringify(snapshot);
    }

    // Helper to add move to history
    function addMoveToHistory(moveDescription) {
        moveHistory.push(moveDescription);
        if (moveHistory.length > MAX_HISTORY_LENGTH) {
            moveHistory.shift(); // Remove the oldest move
        }
        localStorage.setItem('sakhmetSolitaire_moveHistory', JSON.stringify(moveHistory)); // SAVE to localStorage
        console.log("Current Move History:", moveHistory);
    }

    // Helper to detect a repeating cycle (e.g., A->B, B->A, A->B, B->A)
    function detectRepeatingCycle() {
        if (moveHistory.length === MAX_HISTORY_LENGTH) {
            // Check for A, B, A, B pattern
            const move1 = moveHistory[0];
            const move2 = moveHistory[1];
            const move3 = moveHistory[2];
            const move4 = moveHistory[3];

            if (move1 === move3 && move2 === move4 && move1 !== move2) {
                console.warn("!! Repeating Move Cycle Detected: " + move1 + ", " + move2 + ", " + move3 + ", " + move4);
                return true;
            }
        }
        return false;
    }

    // Helper function to extract card value and suit from a string like "2S" or "AS"
    function parseCardString(cardStr) {
        if (!cardStr || cardStr === '?' || cardStr === 'empty') return null;
        let value;
        let suit;
        if (cardStr.length === 2) {
            // Single digit value, single letter suit (e.g., "AS", "2S")
            const valChar = cardStr[0];
            if (valChar === 'A') value = 1;
            else if (valChar === 'J') value = 11;
            else if (valChar === 'Q') value = 12;
            else if (valChar === 'K') value = 13;
            else value = parseInt(valChar);
            suit = cardStr[1];
        } else if (cardStr.length === 3 && cardStr.startsWith('10')) {
            // "10S"
            value = 10;
            suit = cardStr[2];
        } else {
            return null; // Unknown format
        }
        return { value: value, suit: suit };
    }

    // NEW HELPER FUNCTION: Check if a Queen can be immediately played on a given King
    // kingCard: The King card object (value 13)
    // currentWastepile: The parsed wastepile data
    // currentTableau: The parsed tableau data
    function checkImmediateQueenPlayable(kingCard, currentWastepile, currentTableau) {
        const expectedQueenValue = 12; // Queen is 12
        const expectedQueenSuitRed = !isRed(kingCard.suit); // Queen must be opposite color

        // Check Wastepile
        if (currentWastepile.length > 0) {
            const wasteTop = currentWastepile[0];
            if (wasteTop.value === expectedQueenValue && isRed(wasteTop.suit) === expectedQueenSuitRed) {
                return true;
            }
        }

        // Check Tableau top cards
        for (const colKey in currentTableau) {
            // Ensure we don't check the column the King is *moving from* as a source for the Queen
            // If the kingCard is from tableau, skip its original column.
            // This is actually incorrect for *this* function, as it's checking if a Queen from *anywhere* can play on a *potential* King.
            // When used for a King being moved from tableau, `kingCard.col` would be its *original* column.
            // We want to check all *other* columns as potential sources for the Queen.
            // However, the specific usage of this function for King moves from WASTEPILE to empty column should pass `[]` for `currentWastepile`
            // so it doesn't try to play the King on itself.
            const column = currentTableau[colKey];
            if (column.length > 0) {
                const topTableauCard = column[column.length - 1]; // The very top card
                if (topTableauCard.type === 'playable' && topTableauCard.value === expectedQueenValue && isRed(topTableauCard.suit) === expectedQueenSuitRed) {
                    return true;
                }
            }
        }
        return false;
    }


    function runSolverAndHighlight() {
        console.clear();
        clearAllHighlights(); // Clear ALL script-added highlights at the very beginning
        setGameBackground('darkgreen'); // Initial background for a fresh run
        console.log("--- Running Sakhmet Solitaire Helper v1.83.2 ---"); // UPDATED VERSION NUMBER

        const stockpile_count = parseDrawsRemaining();
        const wastepile = parseWastepile();
        const foundations = parseFoundations();
        const tableau = parseTableauForSolver(); // Now includes fullStackIndex
        const fullTableauForLogging = parseFullTableauForLogging(); // Full tableau for accurate facedown checks
        const roundEndButton = getRoundEndButton(); // NEW: Get the round end button if present

        console.log("stockpile_count:", stockpile_count);
        console.log("wastepile:", wastepile.map(c => c ? cardToString(c) + (c.chosen ? ' (chosen)' : '') : 'N/A'));
        console.log("foundations:", foundations.map(f => f ? cardToString(f) + (f.chosen ? ' (chosen)' : '') : 'N/A'));
        console.log("tableau (full stack):", fullTableauForLogging);
        if (roundEndButton) {
            console.log("Round End Button detected.");
        }


        // Check for a card chosen by the user in the game
        let chosenCardInGame = null;
        if (wastepile.length > 0 && wastepile[0].chosen) {
            chosenCardInGame = wastepile[0];
        } else {
            for (const colKey in tableau) {
                const columnCards = tableau[colKey];
                // Iterate from the bottom-most card (top of stack) upwards
                for (let i = columnCards.length - 1; i >= 0; i--) {
                    if (columnCards[i].chosen) {
                        chosenCardInGame = columnCards[i];
                        break;
                    }
                }
                if (chosenCardInGame) break;
            }
        }

        // --- Handle case where a card is chosen by the game using move history ---
        if (chosenCardInGame) {
            console.log(`[Game Chosen Card Detected]: ${cardToString(chosenCardInGame)} (from ${chosenCardInGame.type === 'wastepile_card' ? 'wastepile' : `col${chosenCardInGame.col}`})`);

            // No cyan highlight on the chosen card itself when it's game-chosen.
            // The purpose here is to highlight the *destination* based on history.

            if (moveHistory.length > 0) {
                const lastMoveDescription = moveHistory[moveHistory.length - 1];
                console.log(`[Last Recorded Move]: ${lastMoveDescription}`);

                let targetElementToHighlight = null;
                let targetDescription = null;

                // Try to parse target from the last move description
                // Examples: "Move 2S from col6 to Foundation 1"
                // "Move 8H from col0 to col1 on 9S"
                // "Move KS from Wastepile to empty col3"

                const foundationMatch = lastMoveDescription.match(/to Foundation (\d+)/);
                const tableauOnCardMatch = lastMoveDescription.match(/to (col\d+) on (\w+\w?)/); // e.g., col1 on 9S, col1 on 10S
                const tableauEmptyMatch = lastMoveDescription.match(/to empty (col\d+)/);


                if (foundationMatch) {
                    const foundationIndex = parseInt(foundationMatch[1]) - 1; // Convert 1-indexed to 0-indexed
                    if (foundations[foundationIndex] && foundations[foundationIndex].img) {
                        targetElementToHighlight = foundations[foundationIndex].img;
                        targetDescription = `Foundation ${foundationMatch[1]}`;
                    }
                } else if (tableauOnCardMatch) {
                    const targetColKey = tableauOnCardMatch[1];
                    const targetCardString = tableauOnCardMatch[2];
                    const targetCardInfo = parseCardString(targetCardString);

                    if (tableau[targetColKey]) {
                        // Find the card in the actual tableau that matches the target string
                        const actualTargetCard = tableau[targetColKey].find(card =>
                            card.type === 'playable' &&
                            card.value === targetCardInfo.value &&
                            card.suit === targetCardInfo.suit
                        );
                        if (actualTargetCard && actualTargetCard.img) {
                            targetElementToHighlight = actualTargetCard.img;
                            targetDescription = `${targetColKey} on ${targetCardString}`;
                        }
                    }
                } else if (tableauEmptyMatch) {
                    const targetColKey = tableauEmptyMatch[1];
                    if (tableau[targetColKey]) {
                        // Check if the column is actually empty or has an empty_tableau placeholder
                        const column = tableau[targetColKey];
                        if (column.length === 0) {
                            // If the column is truly empty, we try to find the placeholder.
                            // The game typically places a `new_blank_card.gif` when a column becomes empty.
                            // We need to get the specific image element for that blank card.
                            // This relies on the parsing `parseTableauForSolver` correctly identifying `empty_tableau` type.
                            const emptyPlaceholder = column.find(c => c.type === 'empty_tableau');
                            if (emptyPlaceholder && emptyPlaceholder.img) {
                                targetElementToHighlight = emptyPlaceholder.img;
                            } else {
                                // Fallback for genuinely empty columns without a placeholder img
                                console.warn(`Could not find specific empty tableau image for ${targetColKey}. Trying to find the first image in the top tableau row (hacky).`);
                                // This is a last resort and might not highlight precisely.
                                const colIndex = parseInt(targetColKey.replace('col', ''));
                                const imgInColumnDiv = document.querySelector(`td:nth-child(${colIndex + 2}) > div img`);
                                if (imgInColumnDiv && imgInColumnDiv.src.includes('new_blank_card.gif')) {
                                    targetElementToHighlight = imgInColumnDiv;
                                }
                            }
                        } else if (column.length === 1 && column[0].type === 'empty_tableau') {
                            targetElementToHighlight = column[0].img;
                        }
                        targetDescription = `empty ${targetColKey}`;
                    }
                }

                if (targetElementToHighlight) {
                    applyHighlight(targetElementToHighlight, 'magenta'); // Highlight DESTINATION
                    console.log(`Highlighted destination: ${targetDescription}`);
                } else {
                    console.warn("Could not determine specific destination element from history for highlighting. Background set to darkred.");
                    setGameBackground('darkred'); // Indicate an issue with highlighting
                }
            } else {
                console.warn("No move history available to determine destination for chosen card. Background set to darkred.");
                setGameBackground('darkred'); // Indicate no history
            }
            localStorage.setItem('sakhmetSolitaire_lastGameState', getGameStateSnapshot()); // Save current state
            return; // Stop execution here as a card is chosen and we've handled its highlighting.
        }

        // --- If no card is chosen by the game, proceed with general solver logic ---
        let possibleMoves = [];

        // 1. Evaluate all possible moves and assign scores
        // Score hierarchy (Higher is better):
        // 6.0 + (N * 0.2): Tableau to Tableau, uncovers N facedown (NEW TOP BASE SCORE)
        // 5.7: King from WASTEPILE to newly empty Tableau column + Immediate Queen play
        // 5.6: King from Tableau (top of column) to empty Tableau column + Immediate Queen play
        // 5.5: King from Tableau (top of column) to empty Tableau column + Enables *another stack move*
        // 5.0: Move to foundation (Always top priority)
        // 4.9: King from WASTEPILE to newly empty Tableau column (Highest priority for King to empty, general)
        // 4.3: King from Tableau to Empty column, enables foundation move for card underneath (if not enabling other stacks)
        // 4.1: King from Tableau (top of column) to empty Tableau column (general, if not enabling other stacks/queens)
        // 3.9: Wastepile to Tableau (general)
        // 0.45: Draw card from Stockpile
        // 0.1: End Round / New Round (when stockpile empty)
        // 0.0000000005: Tableau to Tableau ("shuffling" - no facedown revealed, no King from Waste, but *does* enable foundation for card underneath) (EXTREMELY LOW)
        // 0.0000000001: Tableau to Tableau ("shuffling" - no facedown revealed, no King from Waste, no foundation enabled) (EXTREMELY low priority)
        // NEGATIVE SCORE: King from Tableau (top of column, no facedown below) to empty Tableau column (AVOID)

        // a. Wastepile to Foundation (Score 5)
        if (wastepile.length > 0) {
            const topWasteCard = wastepile[0];
            for (let i = 0; i < foundations.length; i++) {
                const currentFoundation = foundations[i];
                if ((currentFoundation.type === 'empty_foundation' && topWasteCard.value === 1) ||
                    (currentFoundation.type === 'playable' && topWasteCard.suit === currentFoundation.suit && topWasteCard.value === currentFoundation.value + 1)) {
                    possibleMoves.push({
                        score: 5.0,
                        description: `Move ${cardToString(topWasteCard)} from Wastepile to Foundation ${i + 1}`,
                        sourceCard: topWasteCard, // For highlighting
                        targetImgElement: foundations[i].img // For highlighting (direct img)
                    });
                }
            }
        }

        // b. Tableau top cards to Foundation (Score 5)
        for (const colKey in tableau) {
            const column = tableau[colKey];
            if (column.length > 0) {
                // Get the actual top-most playable card (last in the array as per parsing logic)
                const topTableauCard = column[column.length - 1];
                if (topTableauCard && topTableauCard.type === 'playable') {
                    for (let i = 0; i < foundations.length; i++) {
                        const currentFoundation = foundations[i];
                        if ((currentFoundation.type === 'empty_foundation' && topTableauCard.value === 1) ||
                            (currentFoundation.type === 'playable' && topTableauCard.suit === currentFoundation.suit && topTableauCard.value === currentFoundation.value + 1)) {
                            possibleMoves.push({
                                score: 5.0,
                                description: `Move ${cardToString(topTableauCard)} from ${colKey} to Foundation ${i + 1}`,
                                sourceCard: topTableauCard, // For highlighting
                                targetImgElement: foundations[i].img // For highlighting (direct img)
                            });
                        }
                    }
                }
            }
        }

        // c. Tableau to Tableau moves (Refined scoring)
        for (const sourceColKey in tableau) {
            const sourceColumn = tableau[sourceColKey]; // Playable cards only
            const fullSourceColumn = fullTableauForLogging[sourceColKey]; // Full column for accurate facedown check

            // If the column is empty or only has an empty placeholder, skip as a source.
            if (sourceColumn.length === 0 || (sourceColumn.length === 1 && sourceColumn[0].type === 'empty_tableau')) {
                continue;
            }

            // Iterate through all *playable* cards in the source column, from the bottom-most to the top-most.
            // Any of these could be the start of a stack that moves.
            for (let i = sourceColumn.length - 1; i >= 0; i--) {
                const topOfMovingStack = sourceColumn[i]; // This is the card that *would be clicked* to move the stack below it.

                if (!topOfMovingStack || topOfMovingStack.type !== 'playable') {
                    continue; // Skip if not a playable card (e.g., empty placeholder if encountered unexpectedly)
                }

                // Calculate potential facedowns revealed if this stack moves
                // This needs to be calculated based on the actual *full stack* index of the card being clicked.
                const revealedFacedownCount = countFacedownsAbove(topOfMovingStack.fullStackIndex, fullSourceColumn);

                // Determine if moving this stack would empty the source column
                // This is true if the *only* exposed card is the one being moved, AND there are no facedown cards above it.
                // Or if it empties the column of all its visible cards and the cards above are facedown.
                const cardsRemainingInSourceAfterMove = sourceColumn.slice(0, i); // Cards that would remain visible if this stack moves
                const wouldEmptySourceColumnCompletely = (cardsRemainingInSourceAfterMove.length === 0 && revealedFacedownCount === 0);

                for (const targetColKey in tableau) {
                    if (sourceColKey === targetColKey) continue; // Cannot move to same column directly

                    const targetColumn = tableau[targetColKey];
                    // targetTopCard for placing a stack should be the bottom-most exposed card
                    const targetTopCard = targetColumn.length > 0 ? targetColumn[targetColumn.length - 1] : null;

                    let isValidMove = false;
                    let currentMoveScore = 0; // Will be set based on conditions
                    let currentMoveDescription = "";
                    let currentTargetImgElement = null; // Stored here for `possibleMoves`

                    const isTargetEmpty = (targetColumn.length === 0 || (targetColumn.length === 1 && targetColumn[0].type === 'empty_tableau'));

                    if (isTargetEmpty) {
                        currentTargetImgElement = (targetColumn.length === 1 && targetColumn[0].type === 'empty_tableau') ? targetColumn[0].img : null;
                        if (topOfMovingStack.value === 13) { // Only Kings to empty columns
                            isValidMove = true;
                            currentMoveDescription = `Move ${cardToString(topOfMovingStack)} (and stack) from ${sourceColKey} to empty ${targetColKey}`;

                            // --- DEVALUATION LOGIC FOR KINGS ALREADY AT TOP OF COLUMN (if no facedowns below) ---
                            const isKingTopAndNoFacedownsBelow = (topOfMovingStack.fullStackIndex === 0 && revealedFacedownCount === 0);

                            if (isKingTopAndNoFacedownsBelow) {
                                currentMoveScore = -10.0; // Very negative score
                                currentMoveDescription += ` (WARNING: King already on top of open column, no facedowns below - DEVALUED!)`;
                            } else {
                                // Check for immediate Queen play (individual card)
                                if (checkImmediateQueenPlayable(topOfMovingStack, wastepile, tableau)) {
                                    currentMoveScore = 5.6; // King to empty + immediate Queen play
                                    currentMoveDescription += ` (ENABLES IMMEDIATE QUEEN PLAY!)`;
                                } else {
                                    // Check if this King move enables *any* other stack to move onto it
                                    let enablesAnotherStackMove = false;
                                    const tempTableauForCheck = JSON.parse(JSON.stringify(tableau)); // Deep copy
                                    if (tempTableauForCheck[sourceColKey]) {
                                        tempTableauForCheck[sourceColKey] = cardsRemainingInSourceAfterMove;
                                        if (tempTableauForCheck[sourceColKey].length === 0 && fullSourceColumn.some(cardStr => cardStr === '?')) {
                                             tempTableauForCheck[sourceColKey].push({ value: '?', suit: '?', chosen: false, type: 'empty_tableau', img: getTableauCardImg(parseInt(sourceColKey.replace('col', '')), 0) });
                                        }
                                    }
                                    tempTableauForCheck[targetColKey] = [topOfMovingStack];

                                    for(const otherSourceColKey in tempTableauForCheck) {
                                        if (otherSourceColKey === sourceColKey || otherSourceColKey === targetColKey) continue;

                                        const otherSourceColumn = tempTableauForCheck[otherSourceColKey];
                                        if (otherSourceColumn.length > 0) {
                                            const otherTopOfStack = otherSourceColumn[otherSourceColumn.length - 1];
                                            if (otherTopOfStack && otherTopOfStack.type === 'playable' &&
                                                (isRed(topOfMovingStack.suit) !== isRed(otherTopOfStack.suit)) &&
                                                (otherTopOfStack.value + 1 === topOfMovingStack.value)) {
                                                enablesAnotherStackMove = true;
                                                break;
                                            }
                                        }
                                    }

                                    if (enablesAnotherStackMove) {
                                        currentMoveScore = 5.5;
                                        currentMoveDescription += ` (King to empty, enables another stack move!)`;
                                    } else {
                                        const cardNewlyExposedInSourceCol = (sourceColumn.length > (i + 1)) ? sourceColumn[i - 1] : null;
                                        let enablesFoundation = false;
                                        if (cardNewlyExposedInSourceCol && cardNewlyExposedInSourceCol.type === 'playable') {
                                            for (const foundation of foundations) {
                                                if ((foundation.type === 'empty_foundation' && cardNewlyExposedInSourceCol.value === 1) ||
                                                    (foundation.type === 'playable' && cardNewlyExposedInSourceCol.suit === foundation.suit && cardNewlyExposedInSourceCol.value === foundation.value + 1)) {
                                                    enablesFoundation = true;
                                                    break;
                                                }
                                            }
                                        }

                                        if (enablesFoundation) {
                                            currentMoveScore = 4.3;
                                            currentMoveDescription += ` (King to empty, enables foundation move)`;
                                        } else {
                                            currentMoveScore = 4.1;
                                            currentMoveDescription += ` (King from Tableau to empty column)`;
                                        }
                                    }
                                }
                            }
                        }
                    } else if (targetTopCard && targetTopCard.type === 'playable') { // Existing face-up card
                        isValidMove = true;
                        currentTargetImgElement = targetTopCard.img;
                        currentMoveDescription = `Move ${cardToString(topOfMovingStack)} (and stack) from ${sourceColKey} to ${targetColKey} on ${cardToString(targetTopCard)}`;

                        if ((isRed(topOfMovingStack.suit) !== isRed(targetTopCard.suit)) &&
                            (topOfMovingStack.value + 1 === targetTopCard.value)) {

                            let enablesKingToEmptyFromWaste = false;
                            if (wouldEmptySourceColumnCompletely) {
                                if (wastepile.length > 0 && wastepile[0].value === 13) {
                                    enablesKingToEmptyFromWaste = true;
                                }
                            }

                            if (enablesKingToEmptyFromWaste) {
                                currentMoveScore = 4.8;
                                currentMoveDescription += ` (enables King from Waste to empty column!)`;
                            } else if (revealedFacedownCount > 0) {
                                currentMoveScore = 6.0 + (revealedFacedownCount * 0.2);
                                currentMoveDescription += ` (uncovers ${revealedFacedownCount} facedown card(s))`;
                            } else {
                                const cardNewlyExposedInSourceCol = (sourceColumn.length > (i + 1)) ? sourceColumn[i - 1] : null;
                                let enablesFoundation = false;
                                if (cardNewlyExposedInSourceCol && cardNewlyExposedInSourceCol.type === 'playable') {
                                    for (const foundation of foundations) {
                                        if ((foundation.type === 'empty_foundation' && cardNewlyExposedInSourceCol.value === 1) ||
                                            (foundation.type === 'playable' && cardNewlyExposedInSourceCol.suit === foundation.suit && cardNewlyExposedInSourceCol.value === foundation.value + 1)) {
                                            enablesFoundation = true;
                                            break;
                                        }
                                    }
                                }
                                if (enablesFoundation) {
                                    currentMoveScore = 0.0000000005;
                                    currentMoveDescription += " (enables foundation move - LOW PRIORITY)";
                                } else {
                                    currentMoveScore = 0.0000000001;
                                    currentMoveDescription += " (minor benefit / shuffling - EXTREMELY low priority)";
                                }
                            }
                        }
                    }

                    if (isValidMove) {
                        possibleMoves.push({
                            score: currentMoveScore,
                            description: currentMoveDescription,
                            sourceCard: topOfMovingStack, // For highlighting
                            targetImgElement: currentTargetImgElement, // For highlighting
                            sourceCol: sourceColKey,
                            targetCol: targetColKey,
                            revealedFacedownCount: revealedFacedownCount
                        });
                    }
                }
            }
        }

        // d. Wastepile to Tableau (general) (Score 3.9 or 4.9 if King to Empty)
        if (wastepile.length > 0) {
            const topWasteCard = wastepile[0];
            for (const targetColKey in tableau) {
                const targetColumn = tableau[targetColKey];
                let isValidMove = false;
                let currentMoveScore = 3.9; // Base score for general waste to tableau
                let currentMoveDescription = "";
                let currentTargetImgElement = null;

                // Check for truly empty column OR an empty placeholder card
                if (targetColumn.length === 0 || (targetColumn.length === 1 && targetColumn[0].type === 'empty_tableau')) {
                    currentTargetImgElement = (targetColumn.length === 1 && targetColumn[0].type === 'empty_tableau') ? targetColumn[0].img : null;
                    if (topWasteCard.value === 13) { // Only Kings to empty columns
                        isValidMove = true;
                        if (checkImmediateQueenPlayable(topWasteCard, [], tableau)) {
                            currentMoveScore = 5.7;
                            currentMoveDescription = `Move ${cardToString(topWasteCard)} from Wastepile to empty ${targetColKey} (ENABLES IMMEDIATE QUEEN PLAY!)`;
                        } else {
                            currentMoveScore = 4.9;
                            currentMoveDescription = `Move ${cardToString(topWasteCard)} from Wastepile to empty ${targetColKey} (PRIORITY KING TO EMPTY!)`;
                        }
                    }
                } else {
                    const targetTopCard = targetColumn[targetColumn.length - 1];
                    if (targetTopCard && targetTopCard.type === 'playable') {
                        currentTargetImgElement = targetTopCard.img;
                        if ((isRed(topWasteCard.suit) !== isRed(targetTopCard.suit)) &&
                            (topWasteCard.value + 1 === targetTopCard.value)) {
                            isValidMove = true;
                            currentMoveScore = 3.9;
                            currentMoveDescription = `Move ${cardToString(topWasteCard)} from Wastepile to ${targetColKey} on ${cardToString(targetTopCard)}`;
                        }
                    }
                }

                if (isValidMove) {
                    possibleMoves.push({
                        score: currentMoveScore,
                        description: currentMoveDescription,
                        sourceCard: topWasteCard, // For highlighting
                        targetImgElement: currentTargetImgElement, // For highlighting
                        targetCol: targetColKey // For target highlighting
                    });
                }
            }
        }

        // e. Stockpile (Draw Card) (Score 0.45 if draws remain)
        if (stockpile_count > 0) {
            possibleMoves.push({
                score: 0.45, // Prioritize drawing over pointless shuffles
                description: `Draw a card from the Stockpile (Draws remaining: ${stockpile_count / 4} rounds, ${stockpile_count} cards)`,
                highlightElement: getStockpileImg() // Direct element for highlighting
            });
        }

        // f. End Round / New Round Button (Score 0.1 if present, indicates no more draws)
        if (roundEndButton) {
            possibleMoves.push({
                score: 0.1, // Low priority, but above drawing if no more draws or if it's the only option
                description: "Click 'End Round / New Round' button",
                highlightElement: roundEndButton.img // Direct element for highlighting
            });
        }

        // 2. Sort moves by score (descending)
        possibleMoves.sort((a, b) => b.score - a.score);

        // 3. Display and highlight the best move
        if (possibleMoves.length > 0) {
            const bestMove = possibleMoves[0];
            console.log("\n--- Recommended Next Move ---");
            console.log(`[Score: ${bestMove.score.toFixed(9)}] ${bestMove.description}`);

            if (bestMove.score < 0.005) {
                setGameBackground('darkred');
            } else {
                setGameBackground('darkgreen');
            }

            // Add the description of the chosen best move to history
            // We only add moves that are significant enough to be considered a "turn"
            if (bestMove.score >= 0.45 || (bestMove.sourceCard && (bestMove.targetCol || bestMove.targetImgElement)) || bestMove.score >= 5.0) {
                let historyMove = '';
                if (bestMove.sourceCard) { // This is a card-to-card/foundation move
                    const sourceCardStr = cardToString(bestMove.sourceCard);
                    if (bestMove.description.includes("to Foundation")) {
                        // Extract foundation number from description
                        const foundationMatch = bestMove.description.match(/to Foundation (\d+)/);
                        const sourceLoc = bestMove.sourceCard.type === 'wastepile_card' ? 'Wastepile' : bestMove.sourceCol;
                        if (foundationMatch) {
                             historyMove = `Move ${sourceCardStr} from ${sourceLoc} to Foundation ${foundationMatch[1]}`;
                        } else {
                            historyMove = bestMove.description; // Fallback
                        }
                    } else if (bestMove.targetCol) { // It's a tableau move
                        const sourceColStr = bestMove.sourceCol || 'Wastepile'; // Source can be tableau or wastepile
                        const targetColStr = bestMove.targetCol;
                        if (bestMove.description.includes("to empty")) {
                            historyMove = `Move ${sourceCardStr} from ${sourceColStr} to empty ${targetColStr}`;
                        } else if (bestMove.description.includes("on ")) {
                            // Extract target card string from description for history (e.g., "9S")
                            const targetCardStringMatch = bestMove.description.match(/on (\w+\w?)/);
                            if (targetCardStringMatch) {
                                historyMove = `Move ${sourceCardStr} from ${sourceColStr} to ${targetColStr} on ${targetCardStringMatch[1]}`;
                            } else {
                                historyMove = bestMove.description; // Fallback
                            }
                        } else {
                            historyMove = bestMove.description; // Fallback for other tableau moves
                        }
                    } else {
                        historyMove = bestMove.description; // Fallback if type not fully recognized
                    }
                } else { // It's a draw or end round button click
                    historyMove = bestMove.description;
                }
                addMoveToHistory(historyMove);
            }


            // Apply highlight for best move
            if (bestMove.highlightElement) { // For Stockpile or End Round button
                applyHighlight(bestMove.highlightElement, 'magenta'); // Only highlight the action
            } else { // It's a card move (Tableau to Tableau, Waste to Tableau, or to Foundation)
                // Highlight the SOURCE card in magenta
                if (bestMove.sourceCard && bestMove.sourceCard.img) {
                    applyHighlight(bestMove.sourceCard.img, 'magenta');
                }
            }
        } else {
            console.log("\n--- No obvious moves found. Consider drawing a card if available. ---");
            if (stockpile_count > 0) {
                applyHighlight(getStockpileImg(), 'magenta');
                setGameBackground('darkred');
            } else if (roundEndButton) {
                applyHighlight(roundEndButton.img, 'magenta');
                setGameBackground('darkred');
            } else {
                 setGameBackground('darkred');
            }
        }

        // Check for repeating cycle AFTER determining best move and adding to history
        if (detectRepeatingCycle()) {
            console.warn("!! History Cycle Detected! Changing background to darkred.");
            setGameBackground('darkred');
        }

        console.log("\n--- Sakhmet Solitaire Helper Finished ---");

        localStorage.setItem('sakhmetSolitaire_lastGameState', getGameStateSnapshot());
    }

    // Initial run on page load and set up periodic re-evaluation
    window.addEventListener('load', () => {
        runSolverAndHighlight();

        setInterval(() => {
            const currentGameState = getGameStateSnapshot();
            if (currentGameState !== localStorage.getItem('sakhmetSolitaire_lastGameState')) {
                runSolverAndHighlight();
            }
        }, 1); // Check every 1ms
    });

})();
