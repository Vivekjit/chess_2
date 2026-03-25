/**
 * Chess2Env - OpenAI Gym-style wrapper for Chess 2 (6x10 Double-Action Engine)
 * 
 * Provides reset(), step(action), and render() methods.
 * Suitable for interfacing with PPO/DQN agents.
 */

class Chess2Env {
    constructor(engine) {
        this.engine = engine; // Reference to the core game logic
        this.rows = 10;
        this.cols = 6;
        this.state = null;
        this.done = false;

        // Piece mapping for observation space
        this.pieceMap = { 'P': 1, 'N': 2, 'B': 3, 'R': 4, 'K': 5 };
        this.colorScale = { 'white': 1, 'dark': -1 };
    }

    /**
     * Resets the environment to the initial board state.
     * @returns {Array} Initial observation (flattened board)
     */
    reset() {
        this.state = this.engine.getInitialBoard();
        this.done = false;
        return this.getObservation();
    }

    /**
     * Returns a list of all legal actions for the current state.
     * Each action: { from: {r,c}, move: {row,col,path} }
     */
    getLegalActions() {
        if (!this.state) return [];
        const actions = [];
        const currentPlayer = this.getCurrentPlayer();

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const piece = this.state[r][c];
                if (piece && piece.color === currentPlayer) {
                    const moves = this.engine.computeDoubleMoves(this.state, r, c);
                    moves.forEach(m => actions.push({ from: { r, c }, move: m }));
                }
            }
        }
        return actions;
    }

    getCurrentPlayer() {
        // Simple heuristic: count pieces or trust engine turn management
        // For RL, we assume the environment tracks whose turn it is
        return this.state.currentPlayer || 'white';
    }

    /**
     * Executes an action by its index in the legal moves list.
     */
    step(actionIndex) {
        const legalActions = this.getLegalActions();

        if (actionIndex >= legalActions.length) {
            return { observation: this.getObservation(), reward: -1.0, done: true, info: { error: 'Action index out of bounds' } };
        }

        const action = legalActions[actionIndex];
        const prevState = JSON.parse(JSON.stringify(this.state));

        // Apply move using game engine
        const nextBoard = this.engine.applyDoubleMove(this.state, action.from.r, action.from.c, action.move);
        const winner = this.engine.checkWin(nextBoard);

        this.state = nextBoard;
        this.done = !!winner;

        const reward = this.calculateReward(prevState, this.state, action.move, winner);

        return {
            observation: this.getObservation(),
            reward: reward,
            done: this.done,
            info: { winner }
        };
    }

    calculateReward(prevState, nextState, move, winner) {
        if (winner) return 1.0; // Capturing King

        let reward = -0.01; // Step penalty
        if (move.isCapture) reward += 0.2; // Capture reward

        return reward;
    }

    getObservation() {
        const obs = new Array(this.rows * this.cols).fill(0);
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const piece = this.state[r][c];
                if (piece) {
                    obs[r * this.cols + c] = this.pieceMap[piece.type] * this.colorScale[piece.color];
                }
            }
        }
        return obs;
    }
}

/**
 * REINFORCEMENT LEARNING BOILERPLATE (Python/PPO)
 * ---------------------------------------------
 * Draft logic for training an agent on the custom 6x10 board.
 */
const ppo_scaffold = `
import gym
import numpy as np
from stable_baselines3 import PPO

class Chess2GymEnv(gym.Env):
    def __init__(self, js_engine):
        self.observation_space = gym.spaces.Box(low=-5, high=5, shape=(60,), dtype=np.int32)
        self.action_space = gym.spaces.Discrete(512) # Max expected legal moves per state

    def step(self, action):
        # Bridge to Node.js wrapper
        return obs, reward, done, info
        
# Training
model = PPO("MlpPolicy", "Chess2-v0", verbose=1)
model.learn(total_timesteps=100000)
`;

if (typeof module !== 'undefined') module.exports = { Chess2Env, ppo_scaffold };
