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
let aiPlayerColor = COLORS.DARK; // Default AI is Dark

// Phase 3: Segmented Move State
let segmentedMoveState = {
    active: false,
    fromCell: null,      // {row, col}
    step1Cell: null,     // {row, col} after first action
    availableStep1: [],  // list of first actions
    availableStep2: [],  // list of second actions from step1Cell
    step2Map: null
};

// Multiplayer
let socket = null;
let myColor = null;
let roomId = null;
let isOnline = false;
let gameClocks = { white: 300, dark: 300 };
let timerInterval = null;

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

            // Rebound never allowed (net movement required)
            if (a2.row === fromRow && a2.col === fromCol) continue;

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

    // Unselect button visibility
    const unselectBtn = $('unselect-btn');
    if (segmentedMoveState.active) {
        unselectBtn.classList.add('active');
    } else {
        unselectBtn.classList.remove('active');
    }

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

    const displayRows = [...rows].reverse();

    displayRows.forEach(row => {
        cols.forEach(col => {
            const tile = document.createElement('div');
            tile.className = 'tile ' + ((row + col) % 2 === 0 ? 'light' : 'dark-tile');
            tile.dataset.row = row;
            tile.dataset.col = col;

            if (lastMoveHighlights.some(h => h.row === row && h.col === col)) tile.classList.add('last-move');

            // Selected piece being moved
            if (segmentedMoveState.active && segmentedMoveState.fromCell &&
                segmentedMoveState.fromCell.row === row && segmentedMoveState.fromCell.col === col) {
                tile.classList.add('selected');
            }

            // Highlight step1Cell (piece's intermediate position after Action 1)
            if (segmentedMoveState.active && segmentedMoveState.step1Cell &&
                segmentedMoveState.step1Cell.row === row && segmentedMoveState.step1Cell.col === col) {
                tile.classList.add('step1-pos');
            }

            // Segmented Highlighting (Phase 3)
            if (segmentedMoveState.active) {
                if (!segmentedMoveState.step1Cell) {
                    // Show Step 1 options (Blue)
                    const m = segmentedMoveState.availableStep1.find(x => x.row === row && x.col === col);
                    if (m) {
                        tile.classList.add(m.isCapture ? 'avail-cap' : 'avail-1');
                    }
                } else {
                    // Show Step 2 options from step1Cell (Orange)
                    const m = segmentedMoveState.availableStep2.find(x => x.row === row && x.col === col);
                    if (m) {
                        tile.classList.add(m.isCapture ? 'avail-cap' : 'avail-2');
                    }
                }
            }

            const piece = board[row][col];
            if (piece) {
                const img = document.createElement('img');
                img.className = 'piece-img';
                img.src = `pieces/${piece.color}-${pieceName(piece.type).toLowerCase()}.svg`;
                img.alt = `${piece.color} ${pieceName(piece.type)}`;

                // DRAG AND DROP
                if (piece.color === currentPlayer && !gameOver && (!isOnline || currentPlayer === myColor)) {
                    img.draggable = true;
                    img.addEventListener('dragstart', (e) => handleDragStart(e, row, col));
                }

                tile.appendChild(img);
            }

            // Tile Events
            tile.addEventListener('click', () => handleTileClick(row, col));

            boardEl.appendChild(tile);
        });
    });

    renderLabels();
    renderCaptures();
    updateUI();
}

function renderCaptures() {
    const wEl = $('captured-by-white');
    const dEl = $('captured-by-dark');
    if (!wEl || !dEl) return;

    wEl.innerHTML = '';
    capturedByWhite.forEach(p => {
        const img = document.createElement('img');
        img.src = `pieces/${p.color}-${pieceName(p.type).toLowerCase()}.svg`;
        img.className = 'captured-piece';
        wEl.appendChild(img);
    });

    dEl.innerHTML = '';
    capturedByDark.forEach(p => {
        const img = document.createElement('img');
        img.src = `pieces/${p.color}-${pieceName(p.type).toLowerCase()}.svg`;
        img.className = 'captured-piece';
        dEl.appendChild(img);
    });
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

    const badge = $('action-badge');
    badge.textContent = 'Select a piece';
    badge.className = 'action-badge';
}

// ===== PIECE HIGHLIGHTING (PHASE 3: SEGMENTED) =====
function computeSegmentedMoves(row, col) {
    const fromPiece = board[row][col];
    if (!fromPiece) return { step1: [], step2Map: new Map() };

    // Get all possible Action 1 destinations
    const step1 = singleMoves(board, row, col).map(m => ({
        ...m, isCapture: !!board[m.row][m.col]
    }));

    const step2Map = new Map();
    for (const s1 of step1) {
        const boardAfterA1 = applyMoveToBoard(board, row, col, s1.row, s1.col);
        const s2List = singleMoves(boardAfterA1, s1.row, s1.col)
            .filter(m => !(m.row === row && m.col === col)) // Rebound never allowed
            .map(m => ({
                ...m, isCapture: !!boardAfterA1[m.row][m.col]
            }));
        step2Map.set(`${s1.row},${s1.col}`, s2List);
    }
    return { step1, step2Map };
}

function unselectPiece() {
    segmentedMoveState.active = false;
    segmentedMoveState.fromCell = null;
    segmentedMoveState.step1Cell = null;
    segmentedMoveState.availableStep1 = [];
    segmentedMoveState.availableStep2 = [];
    selectedCell = null;
    renderBoard();
}

// Global click/DND entry point
function handleTileClick(row, col) {
    if (gameOver || aiThinking || pendingPromotion) return;
    if (isOnline && currentPlayer !== myColor) return;

    // Direct coords from event
    if (typeof row === 'object') {
        const t = row.currentTarget;
        row = parseInt(t.dataset.row);
        col = parseInt(t.dataset.col);
    }

    const piece = board[row][col];

    // Case 1: Start/Re-select current player's piece
    if (piece && piece.color === currentPlayer) {
        if (segmentedMoveState.active && segmentedMoveState.fromCell.row === row && segmentedMoveState.fromCell.col === col) {
            unselectPiece();
            return;
        }
        const { step1, step2Map } = computeSegmentedMoves(row, col);
        segmentedMoveState.active = true;
        segmentedMoveState.fromCell = { row, col };
        segmentedMoveState.step1Cell = null;
        segmentedMoveState.availableStep1 = step1;
        segmentedMoveState.step2Map = step2Map;
        segmentedMoveState.availableStep2 = [];
        renderBoard();
        return;
    }

    // Case 2: Executing Move
    if (segmentedMoveState.active) {
        if (!segmentedMoveState.step1Cell) {
            // Picking Action 1 (Blue/Green)
            const m1 = segmentedMoveState.availableStep1.find(x => x.row === row && x.col === col);
            if (m1) {
                segmentedMoveState.step1Cell = { row, col };
                segmentedMoveState.availableStep2 = segmentedMoveState.step2Map.get(`${row},${col}`) || [];
                renderBoard();
            } else {
                unselectPiece();
            }
        } else {
            // Picking Action 2 (Orange/Green - COMMIT)
            const m2 = segmentedMoveState.availableStep2.find(x => x.row === row && x.col === col);
            if (m2) {
                executeSegmentedMove(segmentedMoveState.fromCell, segmentedMoveState.step1Cell, { row, col });
            } else {
                unselectPiece();
            }
        }
    }
}

// ===== UNDO / HISTORY =====
function pushToHistory() {
    moveHistory.push({
        board: board.map(r => r.map(c => c ? { ...c } : null)),
        currentPlayer,
        capturedByWhite: [...capturedByWhite],
        capturedByDark: [...capturedByDark],
        moveLog: JSON.parse(JSON.stringify(moveLog)),
        turnNumber,
        lastMoveHighlights: [...lastMoveHighlights],
        moveLogHTML: $('move-log-list').innerHTML
    });
}

function undoMove() {
    if (moveHistory.length === 0) { showFlash('Nothing to undo'); return; }
    const s = moveHistory.pop();
    board = s.board;
    currentPlayer = s.currentPlayer;
    capturedByWhite = s.capturedByWhite;
    capturedByDark = s.capturedByDark;
    moveLog = s.moveLog;
    turnNumber = s.turnNumber;
    lastMoveHighlights = s.lastMoveHighlights;
    $('move-log-list').innerHTML = s.moveLogHTML;
    gameOver = false;
    pendingPromotion = null;
    aiThinking = false;
    unselectPiece();
    renderBoard();
    showFlash('Move undone ↩');
}




// Final execution of double-move
function executeSegmentedMove(from, via, to) {
    pushToHistory();
    const p = { ...board[from.row][from.col] };
    const a1Captured = board[via.row][via.col];
    const boardStep1 = applyMoveToBoard(board, from.row, from.col, via.row, via.col);
    const a2Captured = boardStep1[to.row][to.col];

    board = applyMoveToBoard(boardStep1, via.row, via.col, to.row, to.col);

    if (a1Captured) (currentPlayer === COLORS.WHITE ? capturedByWhite : capturedByDark).push(a1Captured);
    if (a2Captured) (currentPlayer === COLORS.WHITE ? capturedByWhite : capturedByDark).push(a2Captured);

    lastMoveHighlights = [{ ...from }, { ...to }];

    // Notation
    const midN = a1Captured ? `x${cellName(via.row, via.col)}` : `-${cellName(via.row, via.col)}`;
    const finalN = a2Captured ? `x${cellName(to.row, to.col)}` : `-${cellName(to.row, to.col)}`;
    const notation = `${p.type}${cellName(from.row, from.col)}${midN}${finalN}`;

    if (p.type === PIECES.PAWN && needsPromotion(to.row, p.color)) {
        pendingPromotion = { row: to.row, col: to.col, color: p.color, notation, via, a1Captured, a2Captured, fromRow: from.row, fromCol: from.col };
        showPromotionModal();
    } else {
        finalizeTurn(notation);
    }
    unselectPiece();
}

function finalizeTurn(notation) {
    logMove(notation);
    const winner = checkWin(board);
    if (winner) { triggerGameOver(winner); return; }

    currentPlayer = (currentPlayer === COLORS.WHITE) ? COLORS.DARK : COLORS.WHITE;
    gameClocks = { white: 300, dark: 300 }; // Shot clock reset
    updateTimerUI(gameClocks, currentPlayer);

    if (isOnline && socket) syncState();

    if (isVsAI && currentPlayer === aiPlayerColor && !gameOver) {
        setTimeout(makeAIMove, 600);
    }
    if (!isOnline) startLocalTimer();
    renderCaptures();
}

function startLocalTimer() {
    stopLocalTimer();
    timerInterval = setInterval(() => {
        if (gameOver) { stopLocalTimer(); return; }
        gameClocks[currentPlayer]--;
        updateTimerUI(gameClocks, currentPlayer);
        if (gameClocks[currentPlayer] <= 0) {
            stopLocalTimer();
            triggerGameOver('draw');
            showFlash("Time Out! Game Drawn.");
        }
    }, 1000);
}

function stopLocalTimer() {
    if (timerInterval) clearInterval(timerInterval);
}

function updateTimerUI(clocks, activeColor) {
    const s = clocks[activeColor];
    if (s === undefined) return;
    const m = Math.floor(Math.max(0, s) / 60);
    const sc = Math.max(0, s) % 60;
    $('game-clock').textContent = `${m.toString().padStart(2, '0')}:${sc.toString().padStart(2, '0')}`;
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
    board[p.row][p.col] = { type: newType, color: p.color };
    pendingPromotion = null;
    $('promotion-modal').classList.remove('active');
    finalizeTurn(`${p.notation}=${newType}`);
}

// ===== WIN CHECK =====
function checkWin(b) {
    let wK = false, dK = false;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (b[r][c]?.type === PIECES.KING) {
                if (b[r][c].color === COLORS.WHITE) wK = true;
                else dK = true;
            }
        }
    }
    if (!wK) return COLORS.DARK;
    if (!dK) return COLORS.WHITE;
    return null;
}

function triggerGameOver(winner) {
    gameOver = true;
    stopLocalTimer();
    const banner = $('game-over-banner');
    const title = $('game-over-text');
    const reason = $('game-over-reason');

    if (winner === 'draw') {
        title.textContent = "Game Drawn! ⚖️";
        reason.textContent = "Time has run out for the current player.";
    } else {
        const isWin = (isOnline && winner === myColor) || (!isOnline && winner === COLORS.WHITE);
        const wName = winner === COLORS.WHITE ? 'White' : 'Dark';

        if (isOnline) {
            title.textContent = (winner === myColor) ? "YOU WON! 🏆" : "YOU LOST! 💀";
        } else {
            title.textContent = `${wName} Wins! 🏆`;
        }
        reason.textContent = "The King has been captured.";
    }

    banner.classList.add('active');
    renderBoard();
}

// ===== UNDO =====
function pushToHistory() {
    moveHistory.push({
        board: JSON.parse(JSON.stringify(board)),
        currentPlayer, turnNumber, moveLog: JSON.parse(JSON.stringify(moveLog)), lastMoveHighlights: [...lastMoveHighlights],
        capturedByWhite: [...capturedByWhite], capturedByDark: [...capturedByDark]
    });
}

function undoMove() {
    if (moveHistory.length === 0 || aiThinking) return;
    const prev = moveHistory.pop();
    board = prev.board; currentPlayer = prev.currentPlayer; turnNumber = prev.turnNumber;
    moveLog = prev.moveLog; lastMoveHighlights = prev.lastMoveHighlights;
    capturedByWhite = prev.capturedByWhite; capturedByDark = prev.capturedByDark;

    gameOver = false;
    rebuildLogUI();
    renderBoard();
    renderCaptures();
    showFlash("Turn Undone");
}

function rebuildLogUI() {
    const list = $('move-log-list'); list.innerHTML = '';
    moveLog.forEach(e => {
        const div = document.createElement('div'); div.className = 'move-entry'; div.id = `move-row-${e.num}`;
        div.innerHTML = `<span class="move-num">${e.num}.</span><span class="move-white">${e.white}</span><span class="move-dark">${e.dark}</span>`;
        list.appendChild(div);
    });
}

// ===== AI =====
function makeAIMove() {
    if (gameOver || aiThinking) return;
    aiThinking = true;
    showFlash("Computer is thinking...");
    setTimeout(() => {
        const best = getBestMove(board, 2);
        aiThinking = false;
        if (best.move) {
            executeSegmentedMove(best.from, best.move.path.via, { row: best.move.row, col: best.move.col });
        } else {
            finalizeTurn("PASS");
        }
    }, 600);
}

function getBestMove(currentBoard, depth) {
    let bestScore = -Infinity, bestMove = null, bestFrom = null;
    const pieces = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (currentBoard[r][c]?.color === aiPlayerColor) pieces.push({ r, c });
        }
    }
    pieces.sort(() => Math.random() - 0.5);
    for (const p of pieces) {
        const moves = computeDoubleMoves(currentBoard, p.r, p.c);
        for (const m of moves) {
            let next = applyMoveToBoard(currentBoard, p.r, p.c, m.path.via.row, m.path.via.col);
            next = applyMoveToBoard(next, m.path.via.row, m.path.via.col, m.row, m.col);
            const score = minimax(next, depth - 1, -Infinity, Infinity, false);
            if (score > bestScore) { bestScore = score; bestMove = m; bestFrom = { row: p.r, col: p.c }; }
        }
    }
    return { from: bestFrom, move: bestMove };
}

function minimax(testBoard, depth, alpha, beta, isMaximizing) {
    const winner = checkWin(testBoard);
    if (winner === aiPlayerColor) return 10000 + depth;
    if (winner && winner !== aiPlayerColor) return -10000 - depth;
    if (depth === 0) return evaluateBoard(testBoard);

    if (isMaximizing) {
        let maxEval = -Infinity;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (testBoard[r][c]?.color === aiPlayerColor) {
                    const moves = computeDoubleMoves(testBoard, r, c);
                    for (const m of moves) {
                        let next = applyMoveToBoard(testBoard, r, c, m.path.via.row, m.path.via.col);
                        next = applyMoveToBoard(next, m.path.via.row, m.path.via.col, m.row, m.col);
                        maxEval = Math.max(maxEval, minimax(next, depth - 1, alpha, beta, false));
                        alpha = Math.max(alpha, maxEval);
                        if (beta <= alpha) break;
                    }
                }
            }
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        const enemy = (aiPlayerColor === COLORS.WHITE) ? COLORS.DARK : COLORS.WHITE;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (testBoard[r][c]?.color === enemy) {
                    const moves = computeDoubleMoves(testBoard, r, c);
                    for (const m of moves) {
                        let next = applyMoveToBoard(testBoard, r, c, m.path.via.row, m.path.via.col);
                        next = applyMoveToBoard(next, m.path.via.row, m.path.via.col, m.row, m.col);
                        minEval = Math.min(minEval, minimax(next, depth - 1, alpha, beta, true));
                        beta = Math.min(beta, minEval);
                        if (beta <= alpha) break;
                    }
                }
            }
        }
        return minEval;
    }
}

function evaluateBoard(testBoard) {
    let score = 0;
    const values = { K: 10000, R: 50, B: 35, N: 30, P: 10 };
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = testBoard[r][c];
            if (!p) continue;
            let val = values[p.type] || 0;
            if (p.color === aiPlayerColor) score += val; else score -= val;
        }
    }
    return score;
}

// ===== MULTIPLAYER =====
function initSocket() {
    if (typeof io === 'undefined') return;
    socket = io();
    socket.on('room_created', ({ roomId: rid, color }) => { roomId = rid; myColor = color; isOnline = true; syncLobbyUI(rid, color); });
    socket.on('room_joined', ({ roomId: rid, color }) => { roomId = rid; myColor = color; isOnline = true; syncLobbyUI(rid, color); });
    socket.on('match_found', ({ roomId: rid, color }) => {
        roomId = rid; myColor = color; isOnline = true;
        $('searching-overlay').classList.remove('active');
        $('online-modal').classList.remove('active');
        showFlash(`Match Found! Playing as ${color.toUpperCase()}`);
        syncLobbyUI(rid, color);
    });
    socket.on('receive_state', s => { board = s.board; currentPlayer = s.currentPlayer; turnNumber = s.turnNumber; moveLog = s.moveLog; lastMoveHighlights = s.lastMoveHighlights; capturedByWhite = s.capturedByWhite; capturedByDark = s.capturedByDark; renderBoard(); rebuildLogUI(); });
    socket.on('timer_update', ({ clocks, activeColor }) => {
        gameClocks = clocks;
        updateTimerUI(clocks, activeColor);
    });
    socket.on('timeout', ({ winner }) => { triggerGameOver(winner); showFlash("Time Out!"); });
    socket.on('opponent_disconnected', () => { showFlash("Opponent Disconnected", 5000); });
}

function syncLobbyUI(rid, color) {
    $('header-room-id').textContent = rid;
    $('header-room-badge').style.display = 'flex';
    $('mp-panel').style.display = 'block';
    $('room-id-display').textContent = rid;
    $('mp-status').textContent = `Live — Playing as ${color}`;
    $('start-screen').style.display = 'none';
    $('game-main').style.display = 'flex';
}

function syncState() {
    if (!socket || !roomId) return;
    socket.emit('sync_state', { roomId, state: { board, currentPlayer, turnNumber, moveLog, lastMoveHighlights, capturedByWhite, capturedByDark } });
}

// ===== INITIALIZATION =====
window.addEventListener('load', () => {
    initSocket();
    board = createInitialBoard();
    renderBoard();

    $('btn-local').addEventListener('click', () => { isVsAI = false; $('lobby-modal').classList.add('active'); });
    $('btn-vs-ai').addEventListener('click', () => { isVsAI = true; $('lobby-modal').classList.add('active'); });
    $('btn-online').addEventListener('click', () => {
        $('online-modal').classList.add('active');
    });
    $('btn-quick-match').addEventListener('click', () => {
        socket.emit('quick_match');
        $('searching-overlay').classList.add('active');
    });
    $('btn-cancel-match').addEventListener('click', () => {
        socket.emit('cancel_match');
        $('searching-overlay').classList.remove('active');
    });
    $('pick-white').addEventListener('click', () => startGame(COLORS.WHITE));
    $('pick-dark').addEventListener('click', () => startGame(COLORS.DARK));
    $('unselect-btn').addEventListener('click', unselectPiece);
    $('btn-undo').addEventListener('click', undoMove);
    $('btn-create-room').addEventListener('click', () => socket.emit('create_room'));
    $('btn-join-room').addEventListener('click', () => {
        const id = $('join-room-input').value.trim().toUpperCase();
        if (id) socket.emit('join_room', { roomId: id });
    });
    $('btn-new-game').addEventListener('click', () => location.reload()); // Simplest reset
    $('btn-play-again').addEventListener('click', () => location.reload());
});

function startGame(color) {
    playerViewColor = color;
    myColor = color;
    aiPlayerColor = (color === COLORS.WHITE) ? COLORS.DARK : COLORS.WHITE;

    $('lobby-modal').classList.remove('active');
    $('start-screen').style.display = 'none';
    $('game-main').style.display = 'flex';

    board = createInitialBoard();
    currentPlayer = COLORS.WHITE;
    gameOver = false;
    gameClocks = { white: 300, dark: 300 };
    updateTimerUI(gameClocks, COLORS.WHITE);
    if (!isOnline) startLocalTimer();

    moveLog = []; capturedByWhite = []; capturedByDark = []; lastMoveHighlights = []; moveHistory = [];
    turnNumber = 1;
    $('game-over-banner').classList.remove('active');
    renderCaptures();
    renderBoard();
    showFlash(`Match Started: You are ${color.toUpperCase()}`);
    if (isVsAI && aiPlayerColor === COLORS.WHITE) setTimeout(makeAIMove, 800);
}
