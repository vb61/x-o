const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// انتظار اللاعبين
let waitingPlayer = null;

io.on('connection', (socket) => {
    console.log('🔌 لاعب جديد:', socket.id);

    // لاعب يطلب البحث عن خصم
    socket.on('searchForPlayer', () => {
        if (waitingPlayer === null) {
            // لا يوجد لاعب في الانتظار
            waitingPlayer = socket.id;
            socket.emit('waitingForOpponent', { message: 'جاري البحث عن خصم...' });
        } else {
            // يوجد لاعب ينتظر → نصنع غرفة جديدة
            const roomId = `room_${Date.now()}_${Math.random().toString(36)}`;
            const player1 = waitingPlayer;
            const player2 = socket.id;

            // إنشاء الغرفة
            socket.join(roomId);
            io.sockets.sockets.get(player1)?.join(roomId);

            // تعيين الرموز عشوائياً
            const symbols = ['X', 'O'];
            const player1Symbol = symbols[Math.floor(Math.random() * 2)];
            const player2Symbol = player1Symbol === 'X' ? 'O' : 'X';

            // إرسال بدء اللعبة لكل لاعب
            io.to(player1).emit('gameStart', {
                roomId: roomId,
                symbol: player1Symbol,
                board: Array(9).fill(null),
                currentTurn: 'X', // X يبدأ دائماً
                gameActive: true
            });

            io.to(player2).emit('gameStart', {
                roomId: roomId,
                symbol: player2Symbol,
                board: Array(9).fill(null),
                currentTurn: 'X',
                gameActive: true
            });

            // تنظيف قائمة الانتظار
            waitingPlayer = null;
        }
    });

    // لاعب يلغي البحث
    socket.on('cancelSearch', () => {
        if (waitingPlayer === socket.id) {
            waitingPlayer = null;
            socket.emit('searchCancelled', { message: 'تم إلغاء البحث' });
        }
    });

    // لاعب يقوم بحركة
    socket.on('makeMove', ({ roomId, index, symbol }) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        if (!room) return;

        // الحصول على حالة اللعبة من الذاكرة المؤقتة (للتخزين البسيط)
        // سنخزن حالة اللعبة في كائن مؤقت لكل غرفة
        if (!gameStates[roomId]) {
            gameStates[roomId] = {
                board: Array(9).fill(null),
                currentTurn: 'X',
                gameActive: true
            };
        }

        const state = gameStates[roomId];
        if (!state.gameActive) return;
        if (state.currentTurn !== symbol) return;
        if (state.board[index] !== null) return;

        // تنفيذ الحركة
        state.board[index] = symbol;

        // التحقق من الفوز
        const winner = checkWinner(state.board);
        let gameActive = true;
        let winnerSymbol = null;

        if (winner) {
            gameActive = false;
            winnerSymbol = winner;
        } else if (state.board.every(cell => cell !== null)) {
            // تعادل
            gameActive = false;
            winnerSymbol = 'draw';
        } else {
            // تغيير الدور
            state.currentTurn = (state.currentTurn === 'X') ? 'O' : 'X';
        }

        state.gameActive = gameActive;

        // إرسال الحالة المحدثة للغرفة
        io.to(roomId).emit('gameStateUpdate', {
            board: state.board,
            currentTurn: state.currentTurn,
            winner: winnerSymbol,
            gameActive: state.gameActive,
            roomId: roomId
        });

        // إذا انتهت اللعبة، نحذف الحالة بعد فترة قصيرة
        if (!gameActive) {
            setTimeout(() => {
                delete gameStates[roomId];
            }, 60000);
        }
    });

    // طلب مباراة جديدة (ريماتش)
    socket.on('rematchRequest', ({ roomId }) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        if (!room) return;

        // إعادة تعيين اللعبة
        gameStates[roomId] = {
            board: Array(9).fill(null),
            currentTurn: 'X',
            gameActive: true
        };

        io.to(roomId).emit('rematchSuccess', {
            board: Array(9).fill(null),
            currentTurn: 'X',
            gameActive: true
        });
    });

    // مغادرة اللعبة
    socket.on('leaveGame', ({ roomId }) => {
        if (roomId) {
            socket.leave(roomId);
            io.to(roomId).emit('opponentLeft', { message: 'الخصم غادر اللعبة' });
            delete gameStates[roomId];
        }
        if (waitingPlayer === socket.id) {
            waitingPlayer = null;
        }
    });

    // عند قطع الاتصال
    socket.on('disconnect', () => {
        console.log('❌ لاعب قطع الاتصال:', socket.id);
        if (waitingPlayer === socket.id) {
            waitingPlayer = null;
        }
    });
});

// دوال مساعدة
const gameStates = {};

function checkWinner(board) {
    const winPatterns = [
        [0,1,2], [3,4,5], [6,7,8],
        [0,3,6], [1,4,7], [2,5,8],
        [0,4,8], [2,4,6]
    ];
    for (let pattern of winPatterns) {
        const [a,b,c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});
