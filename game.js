/**
 * Chess 2 — The Double-Action Skirmish
 * Rules from main-3.tex
 *
 * DOUBLE-MOVE MECHANIC:
 *   - One piece per turn. It uses BOTH its actions in one go.
 *   - When selected, ALL final squares reachable via any 2-move chain are shown at once.
 *   - Clicking a destination teleports the piece there directly (both sub-moves applied internally).
 *   - Blue aura  = normal move destination
 *   - Green aura = destination involves a capture
 *
 * Board coordinate system:
 *   row 0 = rank 1 (White's back rank), row 9 = rank 10 (Dark's back rank)
 *   col 0 = File A … col 5 = File F
 */

'use strict';

// ===== CONSTANTS =====
const COLS = 6;
const ROWS = 10;
const FILES = ['A', 'B', 'C', 'D', 'E', 'F'];
const PIECES = { KING: 'K', ROOK: 'R', BISHOP: 'B', KNIGHT: 'N', PAWN: 'P' };
const COLORS = { WHITE: 'white', DARK: 'dark' };
const PROMOTE_TO = ['R', 'B', 'N'];

// ===== GAME STATE =====
let board = [];
let currentPlayer = COLORS.WHITE;
let selectedCell = null;        // { row, col }
let availableMoves = [];        // [{ row, col, isCapture, path }]  — final destinations after 2 actions
let lastMoveHighlights = [];    // [{ row, col }] cells to highlight as "last move"
let moveLog = [];
let capturedByWhite = [];
let capturedByDark = [];
let gameOver = false;
let pendingPromotion = null;    // { row, col, color, path, fromRow, fromCol }

// AI state
let isVsAI = false;
let aiThinking = false;

// Multiplayer
let socket = null;
let myColor = null;
let roomId = null;
let isOnline = false;

// QoL features
let playerViewColor = COLORS.WHITE; // Board orientation preference
let moveHistory = []; // Stack of states for Undo

// ===== DOM =====
const $ = id => document.getElementById(id);

function showFlash(msg, duration = 2600) {
    const el = $('status-flash');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(showFlash._t);
    showFlash._t = setTimeout(() => el.classList.remove('show'), duration);
}

// ===== BOARD INIT =====
function createInitialBoard() {
    const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const backRank = [PIECES.BISHOP, PIECES.KNIGHT, PIECES.KING, PIECES.ROOK, PIECES.KNIGHT, PIECES.BISHOP];
    backRank.forEach((type, col) => {
        b[0][col] = { type, color: COLORS.WHITE };
        b[ROWS - 1][col] = { type, color: COLORS.DARK };
    });
    for (let col = 0; col < COLS; col++) {
        b[1][col] = { type: PIECES.PAWN, color: COLORS.WHITE };
        b[ROWS - 2][col] = { type: PIECES.PAWN, color: COLORS.DARK };
    }
    return b;
}

// ===== UTILITIES =====
function inBounds(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function cellName(row, col) {
    return FILES[col] + (row + 1);
}

function pieceName(type) {
    return { K: 'King', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' }[type] || type;
}

function cloneBoard(b) {
    return b.map(r => r.map(cell => cell ? { ...cell } : null));
}

// ===== SINGLE-STEP MOVE GENERATION =====
// Returns all squares a piece at (row,col) can reach in ONE action on the given boardState.
function singleMoves(boardState, row, col) {
    const piece = boardState[row][col];
    if (!piece) return [];
    const moves = [];
    const { type, color } = piece;
    const fwd = color === COLORS.WHITE ? 1 : -1;
    const enemy = color === COLORS.WHITE ? COLORS.DARK : COLORS.WHITE;

    switch (type) {
        case PIECES.PAWN: pawnMoves(boardState, row, col, fwd, enemy, moves); break;
        case PIECES.KNIGHT: knightMoves(boardState, row, col, enemy, moves); break;
        case PIECES.BISHOP: bishopMoves(boardState, row, col, enemy, moves); break;
        case PIECES.ROOK: rookMoves(boardState, row, col, fwd, enemy, moves); break;
        case PIECES.KING: kingMoves(boardState, row, col, enemy, moves); break;
    }
    return moves;
}

function pawnMoves(b, row, col, fwd, enemy, out) {
    const nr = row + fwd;
    if (inBounds(nr, col) && !b[nr][col]) out.push({ row: nr, col });
    for (const dc of [-1, 1]) {
        const nc = col + dc;
        if (inBounds(nr, nc) && b[nr][nc] && b[nr][nc].color === enemy)
            out.push({ row: nr, col: nc });
    }
}

function knightMoves(b, row, col, enemy, out) {
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
        const nr = row + dr, nc = col + dc;
        if (!inBounds(nr, nc)) continue;
        const t = b[nr][nc];
        if (!t || t.color === enemy) out.push({ row: nr, col: nc });
    }
}

function bishopMoves(b, row, col, enemy, out) {
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        let r = row + dr, c = col + dc;
        while (inBounds(r, c)) {
            const t = b[r][c];
            if (!t) { out.push({ row: r, col: c }); }
            else if (t.color === enemy) { out.push({ row: r, col: c }); break; }
            else break;
            r += dr; c += dc;
        }
    }
}

function rookMoves(b, row, col, fwd, enemy, out) {
    // Horizontal
    for (const dc of [-1, 1]) {
        let c = col + dc;
        while (inBounds(row, c)) {
            const t = b[row][c];
            if (!t) { out.push({ row, col: c }); }
            else if (t.color === enemy) { out.push({ row, col: c }); break; }
            else break;
            c += dc;
        }
    }
    // Forward ONLY — never backward (key Chess 2 rule)
    let r = row + fwd;
    while (inBounds(r, col)) {
        const t = b[r][col];
        if (!t) { out.push({ row: r, col }); }
        else if (t.color === enemy) { out.push({ row: r, col }); break; }
        else break;
        r += fwd;
    }
}

function kingMoves(b, row, col, enemy, out) {
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = row + dr, nc = col + dc;
            if (!inBounds(nr, nc)) continue;
            const t = b[nr][nc];
            if (!t || t.color === enemy) out.push({ row: nr, col: nc });
        }
    }
}

function applyMoveToBoard(boardState, fr, fc, tr, tc) {
    const nb = cloneBoard(boardState);
    nb[tr][tc] = nb[fr][fc];
    nb[fr][fc] = null;
    return nb;
}

// ===== DOUBLE-MOVE PRE-COMPUTATION =====
/**
 * Compute ALL final squares reachable by moving the piece at (fromRow, fromCol)
 * through exactly 2 sequential legal moves of the SAME piece.
 *
 * Returns: Array of {
 *   row, col        — final destination
 *   isCapture       — true if any enemy piece is captured along the path
 *   path: {
 *     via: { row, col }  — intermediate square after action 1
 *     a1Captured: piece|null
 *     a2Captured: piece|null
 *   }
 * }
 *
 * The origin square is excluded (rebound = no net movement, not useful to show).
 * If multiple paths lead to the same final square, the one with the most captures is preferred.
 */
function computeDoubleMoves(boardState, fromRow, fromCol) {
    const fromPiece = boardState[fromRow][fromCol];
    if (!fromPiece) return [];

    // Map: "row,col" → best { row, col, isCapture, path }
    const destMap = new Map();

    const action1List = singleMoves(boardState, fromRow, fromCol);

    for (const a1 of action1List) {
        const a1Captured = boardState[a1.row][a1.col] || null;
        const boardAfterA1 = applyMoveToBoard(boardState, fromRow, fromCol, a1.row, a1.col);

        const action2List = singleMoves(boardAfterA1, a1.row, a1.col);

        for (const a2 of action2List) {
            const a2Captured = boardAfterA1[a2.row][a2.col] || null;
            const isCapture = !!(a1Captured || a2Captured);
            const key = `${a2.row},${a2.col}`;

            // Rebound allowed ONLY if something was captured (meaningful change)
            if (a2.row === fromRow && a2.col === fromCol && !isCapture) continue;

            if (!destMap.has(key)) {
                destMap.set(key, {
                    row: a2.row, col: a2.col,
                    isCapture,
                    path: { via: { row: a1.row, col: a1.col }, a1Captured, a2Captured }
                });
            } else {
                const existing = destMap.get(key);

                // POLICY: If multiple paths lead to the same square:
                // 1. Prefer the one that avoids collateral capture on step 1 (user's 'logical error').
                if (!a1Captured && existing.path.a1Captured) {
                    destMap.set(key, {
                        row: a2.row, col: a2.col,
                        isCapture,
                        path: { via: { row: a1.row, col: a1.col }, a1Captured, a2Captured }
                    });
                }
                // 2. Otherwise keep the existing one (first found).
            }
        }
    }

    return Array.from(destMap.values());
}

// ===== WIN CHECK =====
function findKing(boardState, color) {
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (boardState[r][c]?.type === PIECES.KING && boardState[r][c].color === color)
                return { row: r, col: c };
    return null;
}

function checkWin(boardState) {
    if (!findKing(boardState, COLORS.WHITE)) return COLORS.DARK;
    if (!findKing(boardState, COLORS.DARK)) return COLORS.WHITE;
    return null;
}

function needsPromotion(row, color) {
    return (color === COLORS.WHITE && row === ROWS - 1) ||
        (color === COLORS.DARK && row === 0);
}

// ===== RENDERING =====
function renderBoard() {
    const boardEl = $('chess-board');
    boardEl.innerHTML = '';

    // Determine rendering order based on playerViewColor
    const rows = [];
    if (playerViewColor === COLORS.WHITE) {
        for (let r = 0; r < ROWS; r++) rows.push(r);
    } else {
        for (let r = ROWS - 1; r >= 0; r--) rows.push(r);
    }

    const cols = [];
    if (playerViewColor === COLORS.WHITE) {
        for (let c = 0; c < COLS; c++) cols.push(c);
    } else {
        for (let c = COLS - 1; c >= 0; c--) cols.push(c);
    }

    // Visual display: outer loop handles vertical stack
    // We want the player's 'home' rank at the bottom.
    // If White: Row 9 at top, Row 0 at bottom.
    // If Dark: Row 0 at top, Row 9 at bottom.
    const displayRows = [...rows].reverse();

    displayRows.forEach(row => {
        cols.forEach(col => {
            const tile = document.createElement('div');
            tile.className = 'tile ' + ((row + col) % 2 === 0 ? 'light' : 'dark-tile');
            tile.dataset.row = row;
            tile.dataset.col = col;

            if (lastMoveHighlights.some(h => h.row === row && h.col === col)) tile.classList.add('last-move');
            if (selectedCell && selectedCell.row === row && selectedCell.col === col) tile.classList.add('selected');

            const avail = availableMoves.find(m => m.row === row && m.col === col);
            if (avail) tile.classList.add(avail.isCapture ? 'avail-capture' : 'avail-move');

            const piece = board[row][col];
            if (piece) {
                const img = document.createElement('img');
                img.className = 'piece-img';
                img.src = `pieces/${piece.color}-${pieceName(piece.type).toLowerCase()}.svg`;
                img.alt = `${piece.color} ${pieceName(piece.type)}`;
                tile.appendChild(img);
            }

            tile.addEventListener('click', handleTileClick);
            boardEl.appendChild(tile);
        });
    });

    renderLabels();
    updateUI();
}

function renderLabels() {
    const rankEl = $('rank-labels');
    const fileEl = $('file-labels');
    rankEl.innerHTML = '';
    fileEl.innerHTML = '';

    const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const files = ['A', 'B', 'C', 'D', 'E', 'F'];

    if (playerViewColor === COLORS.DARK) {
        // Ranks stay 1-10 but order changes if we want 10 at top for White, 1 at top for Dark?
        // Usually, 1 is at the bottom for the player.
        ranks.reverse();
    } else {
        ranks.reverse(); // Default: 10 at top, 1 at bottom
    }

    if (playerViewColor === COLORS.DARK) files.reverse();

    ranks.forEach(r => {
        const lbl = document.createElement('div');
        lbl.className = 'rank-label';
        lbl.textContent = r;
        rankEl.appendChild(lbl);
    });

    files.forEach(f => {
        const lbl = document.createElement('div');
        lbl.className = 'file-label';
        lbl.textContent = f;
        fileEl.appendChild(lbl);
    });
}

function updateUI() {
    const isDark = currentPlayer === COLORS.DARK;
    $('turn-dot').className = `turn-dot ${currentPlayer}`;
    $('turn-name').textContent = isDark ? 'Dark' : 'White';

    // Hide the action-phase badge (no longer relevant in UI)
    const badge = $('action-badge');
    badge.textContent = 'Select a piece';
    badge.className = 'action-badge';

    // Pips — always show "both" since move is pre-computed
    $('pip-1').className = 'action-pip active';
    $('pip-2').className = 'action-pip active';

    renderCaptured();
}

function renderCaptured() {
    const r = (arr, id) => {
        const el = $(id);
        el.innerHTML = '';
        arr.forEach(p => {
            const img = document.createElement('img');
            img.className = 'captured-piece-icon';
            img.src = `pieces/${p.color}-${pieceName(p.type).toLowerCase()}.svg`;
            img.title = `${p.color} ${pieceName(p.type)}`;
            el.appendChild(img);
        });
    };
    r(capturedByWhite, 'captured-by-white');
    r(capturedByDark, 'captured-by-dark');
}

// ===== CLICK HANDLER =====
function handleTileClick(e) {
    if (gameOver || pendingPromotion) return;

    const tile = e.currentTarget;
    const row = parseInt(tile.dataset.row);
    const col = parseInt(tile.dataset.col);

    if (isOnline && myColor && currentPlayer !== myColor) {
        showFlash("It's your opponent's turn.");
        return;
    }

    const piece = board[row][col];

    if (selectedCell) {
        // Is it a valid destination?
        const dest = availableMoves.find(m => m.row === row && m.col === col);
        if (dest) {
            executeTurn(selectedCell.row, selectedCell.col, dest);
            return;
        }
        // Re-select own piece
        if (piece && piece.color === currentPlayer) {
            selectPiece(row, col);
            return;
        }
        // Deselect
        deselect();
        return;
    }

    // Select own piece
    if (piece && piece.color === currentPlayer) {
        selectPiece(row, col);
    }
}

function selectPiece(row, col) {
    selectedCell = { row, col };
    availableMoves = computeDoubleMoves(board, row, col);
    renderBoard();

    if (availableMoves.length === 0) {
        showFlash('This piece has no double-move destinations.');
    }
}

function deselect() {
    selectedCell = null;
    availableMoves = [];
    renderBoard();
}

// ===== EXECUTE A FULL DOUBLE-MOVE TURN =====
/**
 * Apply both sub-moves of the double action in sequence.
 * dest.path = { via, a1Captured, a2Captured }
 */
function executeTurn(fromRow, fromCol, dest) {
    const { row: toRow, col: toCol, path } = dest;
    const { via, a1Captured, a2Captured } = path;
    const movingPiece = board[fromRow][fromCol];

    // Tracker for captured pieces
    const logCaptures = (cap) => {
        if (!cap) return;
        if (currentPlayer === COLORS.WHITE) capturedByWhite.push(cap);
        else capturedByDark.push(cap);
    };

    // Action 1: apply first step
    logCaptures(a1Captured);
    board = applyMoveToBoard(board, fromRow, fromCol, via.row, via.col);

    // Notation building
    const capMid = a1Captured ? `x${cellName(via.row, via.col)}` : `-${cellName(via.row, via.col)}`;
    const capFinal = a2Captured ? `x${cellName(toRow, toCol)}` : `-${cellName(toRow, toCol)}`;
    const notation = `${movingPiece.type}${cellName(fromRow, fromCol)}${capMid}${capFinal}`;

    // Mid-move Promotion check
    if (movingPiece.type === PIECES.PAWN && needsPromotion(via.row, movingPiece.color)) {
        pendingPromotion = {
            row: toRow, col: toCol, color: movingPiece.color,
            notation,
            midStep: true,
            via: { row: via.row, col: via.col }, // where it is now
            final: { row: toRow, col: toCol, cap: a2Captured }
        };
        deselect();
        showPromotionModal();
        return;
    }

    // Action 2: apply second step
    logCaptures(a2Captured);
    board = applyMoveToBoard(board, via.row, via.col, toRow, toCol);

    // Highlights
    lastMoveHighlights = [{ row: fromRow, col: fromCol }, { row: via.row, col: via.col }, { row: toRow, col: toCol }];

    // Final Promotion check
    if (movingPiece.type === PIECES.PAWN && needsPromotion(toRow, movingPiece.color)) {
        pendingPromotion = { row: toRow, col: toCol, color: movingPiece.color, notation };
        deselect();
        showPromotionModal();
        return;
    }

    finalizeTurn(notation);
}

function finalizeTurn(notation) {
    saveToHistory();
    logMove(notation);
    const winner = checkWin(board);
    if (winner) { triggerGameOver(winner); return; }
    switchPlayer();

    // Trigger AI if it's AI turn
    if (isVsAI && currentPlayer === COLORS.DARK && !gameOver) {
        setTimeout(makeAIMove, 600);
    }
}

function saveToHistory() {
    const snap = {
        board: JSON.parse(JSON.stringify(board)),
        currentPlayer,
        turnNumber,
        gameOver,
        lastMoveHighlights: [...lastMoveHighlights],
        capturedByWhite: [...capturedByWhite],
        capturedByDark: [...capturedByDark],
        moveLog: JSON.parse(JSON.stringify(moveLog))
    };
    moveHistory.push(snap);
}

function undoMove() {
    if (moveHistory.length === 0) return;
    const last = moveHistory.pop();
    board = last.board;
    currentPlayer = last.currentPlayer;
    actionPhase = last.actionPhase;
    turnNumber = last.turnNumber;
    gameOver = last.gameOver;
    lastMoveHighlights = last.lastMoveHighlights;

    selectedCell = null; availableMoves = [];
    renderBoard();
    updateUI();

    // Remove last entry from visual log (simplification)
    const list = $('move-log-list');
    if (list.lastChild && list.children.length > 1) list.removeChild(list.lastChild);

    showFlash("Turn Undone", 1000);
}


// ===== MOVE LOG =====
let turnNumber = 1;
function logMove(notation) {
    const list = $('move-log-list');
    const isWhite = currentPlayer === COLORS.WHITE;
    if (isWhite) {
        const row = document.createElement('div');
        row.className = 'move-entry';
        row.id = `move-row-${turnNumber}`;
        row.innerHTML = `<span class="move-num">${turnNumber}.</span><span class="move-white">${notation}</span><span class="move-dark">—</span>`;
        list.appendChild(row);
        moveLog.push({ num: turnNumber, white: notation, dark: '—' });
    } else {
        const existing = $(`move-row-${turnNumber}`);
        if (existing) {
            existing.querySelector('.move-dark').textContent = notation;
            moveLog[moveLog.length - 1].dark = notation;
        } else {
            const row = document.createElement('div');
            row.className = 'move-entry';
            row.innerHTML = `<span class="move-num">${turnNumber}.</span><span class="move-white">—</span><span class="move-dark">${notation}</span>`;
            list.appendChild(row);
            moveLog.push({ num: turnNumber, white: '—', dark: notation });
        }
        turnNumber++;
    }
    list.scrollTop = list.scrollHeight;
}

function switchPlayer() {
    currentPlayer = (currentPlayer === COLORS.WHITE) ? COLORS.DARK : COLORS.WHITE;
    selectedCell = null;
    availableMoves = [];
    renderBoard();
    if (isOnline && socket) syncState();
}

// ===== PROMOTION =====
function showPromotionModal() {
    const { color } = pendingPromotion;
    const choices = $('promotion-choices');
    choices.innerHTML = '';
    PROMOTE_TO.forEach(type => {
        const btn = document.createElement('button');
        btn.className = 'modal-piece-btn';
        const img = document.createElement('img');
        img.src = `pieces/${color}-${pieceName(type).toLowerCase()}.svg`;
        btn.appendChild(img);
        btn.addEventListener('click', () => completePromotion(type));
        choices.appendChild(btn);
    });
    $('promotion-modal').classList.add('active');
}

function completePromotion(newType) {
    const p = pendingPromotion;
    const { row, col, color, notation, midStep, via, final } = p;

    if (midStep) {
        // piece currently at p.via
        board[via.row][via.col] = null;
        // Move new piece to final destination
        if (final.cap) {
            if (color === COLORS.WHITE) capturedByWhite.push(final.cap);
            else capturedByDark.push(final.cap);
        }
        board[final.row][final.col] = { type: newType, color };
    } else {
        board[row][col] = { type: newType, color };
    }

    pendingPromotion = null;
    $('promotion-modal').classList.remove('active');
    finalizeTurn(`${notation}=${newType}`);
}

// ===== AI ALGORITHM (Minimax + Alpha-Beta) =====
function evaluateBoard(testBoard) {
    let score = 0;
    const pieceValues = { K: 10000, R: 50, B: 35, N: 30, P: 10 };

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = testBoard[r][c];
            if (!p) continue;

            let val = pieceValues[p.type] || 0;

            // Positional bonuses
            if (p.type === PIECES.PAWN) {
                // Closer to promotion is better
                const distToPromo = (p.color === COLORS.WHITE) ? (ROWS - 1 - r) : r;
                val += (9 - distToPromo) * 2;
            }

            if (p.color === COLORS.DARK) score += val;
            else score -= val;
        }
    }
    return score;
}

function updateClockUI(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    const el = $('game-clock');
    if (el) el.textContent = timeStr;
}

function makeAIMove() {
    if (gameOver || aiThinking) return;
    aiThinking = true;
    showFlash("Computer is thinking...", 1000);

    // Short delay to let UI update
    setTimeout(() => {
        const startTime = Date.now();
        const best = getBestMove(board, 2); // Depth 2
        aiThinking = false;

        if (best.move) {
            executeTurn(best.from.row, best.from.col, best.move);
        } else {
            console.log("AI has no legal moves?");
            switchPlayer();
        }
    }, 100);
}

function getBestMove(currentBoard, depth) {
    let bestScore = -Infinity;
    let bestMove = null;
    let bestFrom = null;

    // Find all possible double-moves for all pieces
    const allPieces = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (currentBoard[r][c]?.color === COLORS.DARK) {
                allPieces.push({ r, c });
            }
        }
    }

    // Shuffle pieces for variety
    allPieces.sort(() => Math.random() - 0.5);

    for (const p of allPieces) {
        const moves = computeDoubleMoves(currentBoard, p.r, p.c);
        for (const m of moves) {
            const nextBoard = applyDoubleMove(currentBoard, p.r, p.c, m);
            const score = minimax(nextBoard, depth - 1, -Infinity, Infinity, false);
            if (score > bestScore) {
                bestScore = score;
                bestMove = m;
                bestFrom = { row: p.r, col: p.c };
            }
        }
    }

    return { from: bestFrom, move: bestMove };
}

function minimax(testBoard, depth, alpha, beta, isMaximizing) {
    const winner = checkWin(testBoard);
    if (winner === COLORS.DARK) return 10000 + depth;
    if (winner === COLORS.WHITE) return -10000 - depth;
    if (depth === 0) return evaluateBoard(testBoard);

    if (isMaximizing) {
        let maxEval = -Infinity;
        // Dark's turn
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (testBoard[r][c]?.color === COLORS.DARK) {
                    const moves = computeDoubleMoves(testBoard, r, c);
                    for (const m of moves) {
                        const next = applyDoubleMove(testBoard, r, c, m);
                        const ev = minimax(next, depth - 1, alpha, beta, false);
                        maxEval = Math.max(maxEval, ev);
                        alpha = Math.max(alpha, ev);
                        if (beta <= alpha) break;
                    }
                }
            }
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        // White's turn
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (testBoard[r][c]?.color === COLORS.WHITE) {
                    const moves = computeDoubleMoves(testBoard, r, c);
                    for (const m of moves) {
                        const next = applyDoubleMove(testBoard, r, c, m);
                        const ev = minimax(next, depth - 1, alpha, beta, true);
                        minEval = Math.min(minEval, ev);
                        beta = Math.min(beta, ev);
                        if (beta <= alpha) break;
                    }
                }
            }
        }
        return minEval;
    }
}

function applyDoubleMove(b, fr, fc, m) {
    let nb = applyMoveToBoard(b, fr, fc, m.path.via.row, m.path.via.col);
    nb = applyMoveToBoard(nb, m.path.via.row, m.path.via.col, m.row, m.col);
    return nb;
}

// ===== GAME OVER =====
function triggerGameOver(winner) {
    gameOver = true;
    const w = winner === COLORS.WHITE ? 'White' : 'Dark';
    $('gameover-title').textContent = `${w} Wins! 🏆`;
    $('gameover-sub').textContent = `The King has been captured.`;
    $('gameover-modal').classList.add('active');
    renderBoard();
}

function initGame() {
    board = createInitialBoard();
    currentPlayer = COLORS.WHITE;
    selectedCell = null; availableMoves = []; lastMoveHighlights = [];
    moveLog = []; capturedByWhite = []; capturedByDark = [];
    gameOver = false; pendingPromotion = null; turnNumber = 1;
    aiThinking = false;
    moveHistory = [];
    saveToHistory(); // Initial state

    $('move-log-list').innerHTML = '<div style="color:var(--text-secondary);font-size:12px;padding:4px;">Game started. White to move.</div>';
    $('gameover-modal').classList.remove('active');
    $('promotion-modal').classList.remove('active');
    $('lobby-modal').classList.remove('active');
    renderBoard();
}

function initSocket() {
    try {
        if (typeof io === 'undefined') {
            console.warn('Socket.io not found (Static mode active). Online play unavailable.');
            return;
        }
        socket = io();
        socket.on('connect_error', () => {
            console.warn('Could not connect to multiplayer server. Switching to Offline Mode.');
            socket = null;
        });
        socket.on('room_created', ({ roomId: rid, color }) => {
            roomId = rid; myColor = color; isOnline = true;
            $('header-room-id').textContent = rid;
            $('header-room-badge').style.display = 'flex';
            $('mp-panel').style.display = 'block';
            $('room-id-display').textContent = rid;
            $('mp-status').textContent = 'Live — White player';
            showStartScreen(false); initGame();
        });
        socket.on('room_joined', ({ roomId: rid, color }) => {
            roomId = rid; myColor = color; isOnline = true;
            $('header-room-id').textContent = rid;
            $('header-room-badge').style.display = 'flex';
            $('mp-panel').style.display = 'block';
            $('room-id-display').textContent = rid;
            $('mp-status').textContent = 'Live — Dark player';
            showStartScreen(false); initGame();
        });
        socket.on('receive_state', s => loadState(s));
        socket.on('timer_update', ({ clocks, activeColor }) => {
            updateClockUI(clocks[activeColor]);
        });
        socket.on('timeout', ({ winner }) => {
            triggerGameOver(winner, "Time Out!");
        });
        socket.on('opponent_joined', () => showFlash('Opponent joined!'));
        socket.on('opponent_disconnected', () => showFlash('Opponent left.'));
    } catch (e) {
        console.warn('Offline Mode', e);
        socket = null;
    }
}

function syncState() {
    if (!socket || !roomId) return;
    socket.emit('sync_state', {
        roomId, state: {
            board, currentPlayer, capturedByWhite, capturedByDark, moveLog, lastMoveHighlights, turnNumber
        }
    });
}

function loadState(s) {
    board = s.board; currentPlayer = s.currentPlayer;
    capturedByWhite = s.capturedByWhite; capturedByDark = s.capturedByDark;
    moveLog = s.moveLog; lastMoveHighlights = s.lastMoveHighlights;
    turnNumber = s.turnNumber; selectedCell = null; availableMoves = [];
    renderBoard(); rebuildLogUI();
}

function rebuildLogUI() {
    const list = $('move-log-list');
    list.innerHTML = '';
    moveLog.forEach(e => {
        const div = document.createElement('div');
        div.className = 'move-entry'; div.id = `move-row-${e.num}`;
        div.innerHTML = `<span class="move-num">${e.num}.</span><span class="move-white">${e.white}</span><span class="move-dark">${e.dark}</span>`;
        list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
}

function showStartScreen(show) {
    const ss = $('start-screen');
    ss.style.display = show ? 'flex' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
    initSocket(); initGame();

    $('btn-local').addEventListener('click', () => {
        isOnline = false; isVsAI = false;
        $('lobby-modal').classList.add('active');
    });

    $('pick-white').addEventListener('click', () => {
        playerViewColor = COLORS.WHITE;
        $('lobby-modal').classList.remove('active');
        showStartScreen(false); initGame();
    });

    $('pick-dark').addEventListener('click', () => {
        playerViewColor = COLORS.DARK;
        $('lobby-modal').classList.remove('active');
        showStartScreen(false); initGame();
    });

    $('btn-vs-ai').addEventListener('click', () => {
        isOnline = false; isVsAI = true;
        playerViewColor = COLORS.WHITE;
        showStartScreen(false); initGame();
    });

    $('btn-undo').addEventListener('click', undoMove);

    $('btn-create-room').addEventListener('click', () => socket.emit('create_room'));
    $('btn-join-room').addEventListener('click', () => {
        const id = $('join-room-input').value.trim().toUpperCase();
        if (id) socket.emit('join_room', { roomId: id });
    });
    $('btn-new-game').addEventListener('click', initGame);
    $('btn-play-again').addEventListener('click', initGame);
});
