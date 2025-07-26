// main.js
/*
 * Minimal 2D platformer inspired by OvO.
 *
 * The entire game is contained within this file.  The code is kept
 * modular to encourage readability and to support expansion.  All
 * gameplay logic executes client‑side and no external game engines
 * are used.  Levels are generated procedurally to produce 50 unique
 * stages with increasing variety.
 */

(function () {
  /**
   * Grab references to DOM elements once.  These elements provide
   * canvas rendering, overlay interfaces for menus, and control buttons.
   */
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const startScreen = document.getElementById('startScreen');
  const pauseScreen = document.getElementById('pauseScreen');
  const levelCompleteScreen = document.getElementById('levelCompleteScreen');
  const levelSelectScreen = document.getElementById('levelSelectScreen');
  const skinsScreen = document.getElementById('skinsScreen');
  const levelListDiv = document.getElementById('levelList');
  const skinsListDiv = document.getElementById('skinsList');
  const timeStatsDiv = document.getElementById('timeStats');

  /**
   * Simple input manager.  The state of directional keys and jump
   * requests are tracked here.  Jump requests are queued and must
   * be consumed explicitly by the player each frame so that jump
   * buffering can be supported.  Escape/P toggles pause.
   */
  const Input = {
    left: false,
    right: false,
    down: false,
    jumpRequested: false,
    init() {
      window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        // prevent the default behaviour for arrow keys to avoid
        // unintentional scrolling.
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key)) {
          e.preventDefault();
        }
        switch (k) {
          case 'arrowleft':
          case 'a':
            this.left = true;
            break;
          case 'arrowright':
          case 'd':
            this.right = true;
            break;
          case 'arrowdown':
          case 's':
            this.down = true;
            break;
          case 'arrowup':
          case 'w':
            // queue a jump request
            this.jumpRequested = true;
            break;
          case 'p':
          case 'escape':
            Game.togglePause();
            break;
        }
      });
      window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        switch (k) {
          case 'arrowleft':
          case 'a':
            this.left = false;
            break;
          case 'arrowright':
          case 'd':
            this.right = false;
            break;
          case 'arrowdown':
          case 's':
            this.down = false;
            break;
        }
      });
    },
    /**
     * Consume the jump request if there was one.  This function
     * returns true once per key press and then resets the flag.
     */
    consumeJump() {
      if (this.jumpRequested) {
        this.jumpRequested = false;
        return true;
      }
      return false;
    },
  };

  /**
   * Player represents the stickman controlled by the user.  It
   * encapsulates all physics (acceleration, friction, gravity,
   * jumping, sliding, diving and wall jumping) as well as basic
   * state such as whether the character is on the ground or
   * touching a wall.  The update() method uses delta time to
   * advance the simulation and query collisions from the current
   * level.  Drawing is relative to the camera offset.
   */
  class Player {
    constructor(spawnX, spawnY, skinColor) {
      this.x = spawnX;
      this.y = spawnY;
      this.width = 24;
      this.height = 40;
      this.baseHeight = this.height;
      this.color = skinColor;
      this.velX = 0;
      this.velY = 0;
      this.acc = 0.4; // horizontal acceleration per frame
      this.maxSpeed = 5.5; // maximum horizontal speed
      this.jumpForce = 9;
      this.gravity = 0.45;
      this.onGround = false;
      this.onWall = false;
      this.wallDir = 0; // -1 left, 1 right
      this.sliding = false;
      this.slideTimer = 0;
      this.slideDuration = 15;
      this.dive = false;
      this.coyoteTimer = 0;
      this.jumpBuffer = 0;
    }

    /**
     * Called once per frame.  Updates the player's position,
     * velocity and state based on input and collisions.  dt is a
     * multiplier representing how many 1/60th of a second have
     * elapsed (to keep physics consistent if the browser slows).
     */
    update(dt, level) {
      // Apply horizontal input
      let move = 0;
      if (Input.left) move -= 1;
      if (Input.right) move += 1;
      // accelerate horizontally
      this.velX += move * this.acc;
      // apply friction if no input
      if (move === 0) {
        this.velX *= 0.8;
        if (Math.abs(this.velX) < 0.05) this.velX = 0;
      }
      // cap horizontal speed
      if (this.velX > this.maxSpeed) this.velX = this.maxSpeed;
      if (this.velX < -this.maxSpeed) this.velX = -this.maxSpeed;

      // initiate slide if down pressed on ground and moving fast
      if (this.onGround && Input.down && !this.sliding && Math.abs(this.velX) > 2) {
        this.sliding = true;
        this.slideTimer = this.slideDuration;
        this.height = this.baseHeight / 2;
        // adjust y so bottom stays aligned
        this.y += this.baseHeight - this.height;
        // small boost
        this.velX += this.velX > 0 ? 1 : -1;
      }
      // handle sliding state
      if (this.sliding) {
        this.slideTimer -= dt;
        this.velX *= 0.98;
        if (this.slideTimer <= 0 || !Input.down) {
          // end slide
          this.sliding = false;
          // restore height
          const oldHeight = this.height;
          this.height = this.baseHeight;
          this.y -= this.baseHeight - oldHeight;
        }
      }

      // Dive: pressing down while in air triggers a fast drop
      if (!this.onGround && Input.down && !this.dive) {
        this.dive = true;
        this.velY = 12;
      }

      // Update coyote timer when on ground
      if (this.onGround) {
        this.coyoteTimer = 6; // roughly 0.1s
      } else if (this.coyoteTimer > 0) {
        this.coyoteTimer -= dt;
      }

      // Jump buffering: if jump requested set buffer
      if (Input.consumeJump()) {
        this.jumpBuffer = 6; // 0.1s
      } else if (this.jumpBuffer > 0) {
        this.jumpBuffer -= dt;
      }

      // Jump when jump buffer and coyote
      if (this.jumpBuffer > 0) {
        if (this.coyoteTimer > 0) {
          // normal jump
          this.velY = -this.jumpForce;
          this.onGround = false;
          this.coyoteTimer = 0;
          this.jumpBuffer = 0;
        } else if (this.onWall) {
          // wall jump
          this.velY = -this.jumpForce * 0.9;
          this.velX = -this.wallDir * (this.maxSpeed * 0.8);
          this.onWall = false;
          this.jumpBuffer = 0;
        }
      }

      // apply gravity
      this.velY += this.gravity;
      if (this.velY > 15) this.velY = 15;

      // Proposed new position
      let nextX = this.x + this.velX;
      let nextY = this.y + this.velY;

      // Query level collision and adjust accordingly
      const coll = level.collide(this, nextX, nextY);
      this.x = coll.x;
      this.y = coll.y;
      this.onGround = coll.onGround;
      this.onWall = coll.onWall;
      this.wallDir = coll.wallDir;
      // bounce pad interaction
      if (coll.bounce) {
        this.velY = -this.jumpForce * 1.5;
        this.dive = false;
      }
      // hazard check
      if (coll.die) {
        Game.resetLevel();
        return;
      }
      if (coll.win) {
        Game.completeLevel();
        return;
      }
      if (coll.collectedCoin) {
        Game.addCoin();
      }
      // Reset dive when touching ground
      if (this.onGround) {
        this.dive = false;
      }
    }

    /**
     * Draw the player.  The camera offset is subtracted to
     * translate world coordinates to screen coordinates.  For
     * simplicity the player is rendered as a rectangle coloured
     * according to the selected skin.
     */
    draw(ctx, camera) {
      ctx.fillStyle = this.color;
      const drawX = this.x - camera.x;
      const drawY = this.y - camera.y;
      ctx.fillRect(drawX, drawY, this.width, this.height);
    }
  }

  /**
   * Represents a single level.  Each level is built from a 2D
   * array of characters.  The level class exposes collision
   * detection and hazard/coin management, along with drawing
   * routines.  Moving hazards are stored separately and updated
   * each frame.
   */
  class Level {
    constructor(mapArray) {
      // convert each row into an array of characters for easy
      // modification
      this.map = mapArray.map((row) => row.split(''));
      this.rows = this.map.length;
      this.cols = this.map[0].length;
      this.tileSize = 40;
      this.spawnX = 0;
      this.spawnY = 0;
      this.coins = [];
      this.hazards = [];
      this.parse();
    }

    /**
     * Iterate through map and populate spawn, coins and moving
     * hazards.  Replace consumed tokens with blanks so the
     * underlying map remains free for collision queries.
     */
    parse() {
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const ch = this.map[y][x];
          if (ch === 'P') {
            this.spawnX = x * this.tileSize;
            // spawn on top of tile
            this.spawnY = y * this.tileSize;
            this.map[y][x] = ' ';
          } else if (ch === 'C') {
            this.coins.push({ x: x * this.tileSize + this.tileSize / 2, y: y * this.tileSize + this.tileSize / 2, collected: false });
            this.map[y][x] = ' ';
          } else if (ch === 'H') {
            // create moving horizontal hazard; moves left/right 3 tiles
            const baseX = x * this.tileSize;
            const baseY = y * this.tileSize;
            const range = this.tileSize * 3;
            const speed = 2 + Math.random() * 1; // vary speed slightly
            this.hazards.push({
              type: 'H',
              baseX,
              y: baseY,
              x: baseX,
              width: this.tileSize,
              height: this.tileSize,
              range,
              dir: Math.random() < 0.5 ? -1 : 1,
              speed,
            });
            this.map[y][x] = ' ';
          }
        }
      }
    }

    /**
     * Update moving hazards positions.  Hazards move between
     * baseX ± range and bounce off their extents.  Only horizontal
     * moving hazards are implemented here for simplicity.
     */
    updateHazards(dt) {
      for (const hz of this.hazards) {
        if (hz.type === 'H') {
          hz.x += hz.dir * hz.speed;
          if (hz.x < hz.baseX - hz.range) {
            hz.x = hz.baseX - hz.range;
            hz.dir *= -1;
          } else if (hz.x > hz.baseX + hz.range) {
            hz.x = hz.baseX + hz.range;
            hz.dir *= -1;
          }
        }
      }
    }

    /**
     * Determine if a given tile character is solid.  Solid tiles
     * impede movement; breakable tiles ('X') are considered solid
     * until broken via dive.
     */
    isSolid(ch) {
      return ch === '#' || ch === 'X' || ch === 'B';
    }

    /**
     * Collision detection and response.  Accepts the player and
     * proposed new coordinates (nextX, nextY).  Performs axis
     * aligned bounding box checks against the tile map and moving
     * hazards.  Adjusts the player's position and flags based on
     * collisions.  Returns an object with corrected x/y and
     * booleans for onGround, onWall, wallDir, bounce, die, win and
     * collectedCoin.
     */
    collide(player, nextX, nextY) {
      const ts = this.tileSize;
      let px = nextX;
      let py = nextY;
      let onGround = false;
      let onWall = false;
      let wallDir = 0;
      let bounce = false;
      let die = false;
      let win = false;
      let collectedCoin = false;

      const w = player.width;
      const h = player.height;

      // Helper to check tile and respond
      const checkTile = (tx, ty, horizontal) => {
        if (ty < 0 || ty >= this.rows || tx < 0 || tx >= this.cols) return;
        const ch = this.map[ty][tx];
        if (this.isSolid(ch)) {
          const tileX = tx * ts;
          const tileY = ty * ts;
          if (ch === 'X' && player.dive && player.velY > 0) {
            // breakable tile broken by dive
            this.map[ty][tx] = ' ';
            return;
          }
          if (horizontal) {
            // horizontal collision
            if (player.velX > 0) {
              px = tileX - w;
              player.velX = 0;
              onWall = true;
              wallDir = 1;
            } else if (player.velX < 0) {
              px = tileX + ts;
              player.velX = 0;
              onWall = true;
              wallDir = -1;
            }
          } else {
            // vertical collision
            if (player.velY > 0) {
              py = tileY - h;
              player.velY = 0;
              onGround = true;
            } else if (player.velY < 0) {
              py = tileY + ts;
              player.velY = 0;
            }
            if (ch === 'B' && player.velY > 0) {
              bounce = true;
            }
          }
        } else if (ch === 'S') {
          // Hazard tile
          die = true;
        } else if (ch === 'F') {
          // Flag tile
          win = true;
        }
      };

      // Horizontal collisions
      // compute vertical tile range that player occupies
      const top = Math.floor(py / ts);
      const bottom = Math.floor((py + h - 1) / ts);
      if (player.velX !== 0) {
        if (player.velX > 0) {
          // moving right: check tiles to right of player's right edge
          const rightEdge = px + w;
          const col = Math.floor(rightEdge / ts);
          for (let row = top; row <= bottom; row++) {
            checkTile(col, row, true);
          }
        } else {
          // moving left: check tiles to left of player's left edge
          const leftEdge = px;
          const col = Math.floor(leftEdge / ts);
          for (let row = top; row <= bottom; row++) {
            checkTile(col, row, true);
          }
        }
      }

      // Vertical collisions
      const left = Math.floor(px / ts);
      const right = Math.floor((px + w - 1) / ts);
      if (player.velY !== 0) {
        if (player.velY > 0) {
          // moving down: check tiles below player's bottom
          const bottomEdge = py + h;
          const row = Math.floor(bottomEdge / ts);
          for (let col = left; col <= right; col++) {
            checkTile(col, row, false);
          }
        } else {
          // moving up: check tiles above player's top
          const topEdge = py;
          const row = Math.floor(topEdge / ts);
          for (let col = left; col <= right; col++) {
            checkTile(col, row, false);
          }
        }
      }

      // Collect coins
      for (const coin of this.coins) {
        if (!coin.collected) {
          const dx = px + w / 2 - coin.x;
          const dy = py + h / 2 - coin.y;
          // simple bounding radius check
          if (Math.abs(dx) < ts / 2 && Math.abs(dy) < ts / 2) {
            coin.collected = true;
            collectedCoin = true;
          }
        }
      }

      // Moving hazard collisions
      for (const hz of this.hazards) {
        const hx = hz.x;
        const hy = hz.y;
        const hw = hz.width;
        const hh = hz.height;
        if (px < hx + hw && px + w > hx && py < hy + hh && py + h > hy) {
          die = true;
        }
      }

      return { x: px, y: py, onGround, onWall, wallDir, bounce, die, win, collectedCoin };
    }

    /**
     * Draw the static elements of the level (tiles), coins and
     * moving hazards.  Only tiles within the viewport are drawn
     * for performance.  Colours are chosen for clarity.
     */
    draw(ctx, camera) {
      const ts = this.tileSize;
      const startCol = Math.floor(camera.x / ts);
      const endCol = Math.ceil((camera.x + canvas.width) / ts);
      const startRow = Math.floor(camera.y / ts);
      const endRow = Math.ceil((camera.y + canvas.height) / ts);
      for (let y = startRow; y < endRow; y++) {
        if (y < 0 || y >= this.rows) continue;
        for (let x = startCol; x < endCol; x++) {
          if (x < 0 || x >= this.cols) continue;
          const ch = this.map[y][x];
          const drawX = x * ts - camera.x;
          const drawY = y * ts - camera.y;
          if (ch === '#') {
            ctx.fillStyle = '#666';
            ctx.fillRect(drawX, drawY, ts, ts);
          } else if (ch === 'S') {
            ctx.fillStyle = '#b00';
            ctx.fillRect(drawX + ts * 0.2, drawY + ts * 0.2, ts * 0.6, ts * 0.6);
          } else if (ch === 'B') {
            ctx.fillStyle = '#37f';
            ctx.fillRect(drawX + ts * 0.1, drawY + ts * 0.1, ts * 0.8, ts * 0.8);
          } else if (ch === 'F') {
            ctx.fillStyle = '#fd0';
            ctx.beginPath();
            ctx.moveTo(drawX + ts * 0.2, drawY + ts);
            ctx.lineTo(drawX + ts * 0.8, drawY + ts * 0.5);
            ctx.lineTo(drawX + ts * 0.2, drawY + ts * 0.2);
            ctx.closePath();
            ctx.fill();
          } else if (ch === 'X') {
            ctx.fillStyle = '#886633';
            ctx.fillRect(drawX, drawY, ts, ts);
          }
        }
      }
      // draw coins
      for (const coin of this.coins) {
        if (!coin.collected) {
          const cx = coin.x - camera.x;
          const cy = coin.y - camera.y;
          ctx.fillStyle = '#fc0';
          ctx.beginPath();
          ctx.arc(cx, cy, ts * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // draw moving hazards
      for (const hz of this.hazards) {
        const hx = hz.x - camera.x;
        const hy = hz.y - camera.y;
        ctx.fillStyle = '#e22';
        ctx.fillRect(hx + 8, hy + 8, hz.width - 16, hz.height - 16);
      }
    }
  }

  /**
   * The Game object orchestrates the entire application.  It holds
   * state such as which level is loaded, the player, coins
   * collected and UI state.  It also manages the main loop via
   * requestAnimationFrame and responds to UI button presses.
   */
  const Game = {
    state: 'menu', // menu, playing, paused, complete, levelSelect, skins
    levels: [],
    currentLevelIndex: 0,
    level: null,
    player: null,
    camera: { x: 0, y: 0 },
    coins: 0,
    // tracking coins collected this session for unlocking skins
    sessionCoins: 0,
    totalLevels: 50,
    skins: [],
    selectedSkinIndex: 0,
    bestTimes: {},
    levelStartTime: 0,
    currentTime: 0,
    lastFrame: 0,
    /**
     * Initialize game systems (input, UI events, levels, skins,
     * load/save) and start the main loop.  The start screen is
     * visible on initial load.
     */
    init() {
      Input.init();
      this.loadProgress();
      this.buildLevels();
      this.buildSkins();
      this.buildLevelSelectUI();
      this.buildSkinsUI();
      this.attachUIEvents();
      this.loop(performance.now());
    },
    /**
     * Attach event handlers for all UI buttons.  Buttons simply
     * update the game state and call other high‑level functions.
     */
    attachUIEvents() {
      document.getElementById('playButton').onclick = () => {
        this.startGame(0);
      };
      document.getElementById('levelSelectButton').onclick = () => {
        this.showLevelSelect();
      };
      document.getElementById('skinsButton').onclick = () => {
        this.showSkins();
      };
      document.getElementById('resumeButton').onclick = () => {
        this.togglePause(false);
      };
      document.getElementById('retryButton').onclick = () => {
        this.resetLevel();
      };
      document.getElementById('exitButton').onclick = () => {
        this.exitToMenu();
      };
      document.getElementById('nextLevelButton').onclick = () => {
        this.nextLevel();
      };
      document.getElementById('retryLevelButton').onclick = () => {
        this.resetLevel();
      };
      document.getElementById('exitToMenuButton').onclick = () => {
        this.exitToMenu();
      };
      document.getElementById('closeLevelSelectButton').onclick = () => {
        this.showMenu();
      };
      document.getElementById('closeSkinsButton').onclick = () => {
        this.showMenu();
      };
    },
    /**
     * Build the list of levels.  Levels are procedurally generated
     * using a deterministic algorithm that varies content based on
     * the index.  Each generated map is an array of strings.
     */
    buildLevels() {
      for (let i = 0; i < this.totalLevels; i++) {
        const map = this.generateLevel(i);
        this.levels.push(map);
      }
    },
    /**
     * Procedurally generate a single level.  The generated map
     * contains basic ground, a spawn, a flag, hazards, breakable
     * blocks, coins, bounce pads and moving hazards.  Variation is
     * achieved by using the index to compute pseudo‑random
     * positions.  All maps have a uniform size for simplicity.
     */
    generateLevel(index) {
      const height = 12;
      const width = 40;
      // Create blank map
      const map = [];
      for (let r = 0; r < height; r++) {
        const row = new Array(width).fill(' ');
        map.push(row);
      }
      // Build ground on last row
      for (let c = 0; c < width; c++) {
        map[height - 1][c] = '#';
      }
      // Spawn
      map[height - 2][1] = 'P';
      // Flag
      map[height - 2][width - 2] = 'F';
      // Hazards count increases slowly
      const hazardCount = 2 + Math.floor(index / 10);
      for (let h = 0; h < hazardCount; h++) {
        let col = (index * 7 + h * 11) % (width - 4) + 2;
        // avoid spawning hazards on flag
        if (col === width - 2) col = (col + 5) % (width - 4) + 2;
        map[height - 2][col] = 'S';
      }
      // Bounce pad every third level
      if (index % 3 === 0) {
        const col = Math.floor(width / 2);
        map[height - 2][col] = 'B';
      }
      // Breakable tiles on row above ground
      const breakCount = index % 3;
      for (let b = 0; b < breakCount; b++) {
        let col = (index * 5 + b * 13) % (width - 6) + 3;
        map[height - 3][col] = 'X';
      }
      // Coins on two rows above ground
      const coinCount = 3;
      for (let c = 0; c < coinCount; c++) {
        let col = (index * 3 + c * 13) % (width - 6) + 3;
        map[height - 4][col] = 'C';
      }
      // Floating platforms
      const platformCount = 2 + (index % 3);
      for (let p = 0; p < platformCount; p++) {
        let col = (index * 6 + p * 12) % (width - 10) + 5;
        for (let k = 0; k < 4; k++) {
          map[height - 5][col + k] = '#';
        }
      }
      // Moving hazards (H) occasionally
      const movingCount = index % 2;
      for (let mh = 0; mh < movingCount; mh++) {
        let col = (index * 4 + mh * 17) % (width - 10) + 5;
        map[height - 4][col] = 'H';
      }
      // Convert each row to string
      return map.map((row) => row.join(''));
    },
    /**
     * Construct a simple list of available skins.  Each skin has a
     * colour and a price.  The first skin is free.  Additional
     * skins are progressively more expensive.  Unlocked skins are
     * stored in localStorage.
     */
    buildSkins() {
      // Predefined colours
      const colours = ['#ffffff', '#00ffff', '#ff00ff', '#00ff00', '#ffa500', '#ff4444'];
      this.skins = colours.map((c, idx) => {
        return {
          color: c,
          price: idx * 20, // progressive pricing
          unlocked: false,
        };
      });
      // ensure first skin is unlocked
      this.skins[0].unlocked = true;
      // load unlocked skins from storage
      if (this.savedData && this.savedData.skins) {
        this.savedData.skins.forEach((unlocked, idx) => {
          if (unlocked) this.skins[idx].unlocked = true;
        });
        this.selectedSkinIndex = this.savedData.selectedSkinIndex || 0;
      }
    },
    /**
     * Build the level select UI.  Generates a button for each
     * level.  Buttons show a star if the level has been completed
     * (best time recorded).  Clicking a button starts that level.
     */
    buildLevelSelectUI() {
      levelListDiv.innerHTML = '';
      for (let i = 0; i < this.totalLevels; i++) {
        const btn = document.createElement('button');
        const levelNum = i + 1;
        btn.textContent = `Level ${levelNum}`;
        btn.style.margin = '4px';
        // show a mark if completed
        if (this.bestTimes[i] !== undefined) {
          btn.textContent += ` ★`;
        }
        btn.onclick = () => {
          this.startGame(i);
        };
        levelListDiv.appendChild(btn);
      }
    },
    /**
     * Build the skins selection UI.  Each skin is presented with
     * its colour, price and unlock status.  When unlocked the skin
     * can be selected.  Locked skins show the price and allow
     * purchase when coins are sufficient.
     */
    buildSkinsUI() {
      skinsListDiv.innerHTML = '';
      this.skins.forEach((skin, idx) => {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.marginBottom = '6px';
        const swatch = document.createElement('div');
        swatch.style.width = '24px';
        swatch.style.height = '24px';
        swatch.style.background = skin.color;
        swatch.style.marginRight = '8px';
        wrapper.appendChild(swatch);
        const label = document.createElement('span');
        label.style.flex = '1';
        label.textContent = `Skin ${idx + 1}`;
        if (!skin.unlocked) {
          label.textContent += ` - ${skin.price} coins`;
        }
        wrapper.appendChild(label);
        const action = document.createElement('button');
        if (skin.unlocked) {
          action.textContent = idx === this.selectedSkinIndex ? 'Selected' : 'Select';
          action.disabled = idx === this.selectedSkinIndex;
          action.onclick = () => {
            this.selectedSkinIndex = idx;
            this.buildSkinsUI();
            this.saveProgress();
          };
        } else {
          action.textContent = 'Buy';
          action.disabled = this.coins < skin.price;
          action.onclick = () => {
            if (this.coins >= skin.price) {
              this.coins -= skin.price;
              skin.unlocked = true;
              this.selectedSkinIndex = idx;
              this.buildSkinsUI();
              this.saveProgress();
            }
          };
        }
        wrapper.appendChild(action);
        skinsListDiv.appendChild(wrapper);
      });
    },
    /**
     * Return the colour of the currently selected skin.
     */
    getSelectedSkinColor() {
      return this.skins[this.selectedSkinIndex].color;
    },
    /**
     * Save coins, unlocked skins, selected skin and best times to
     * localStorage.  This allows progress to persist across page
     * reloads.
     */
    saveProgress() {
      const data = {
        coins: this.coins,
        skins: this.skins.map((s) => s.unlocked),
        selectedSkinIndex: this.selectedSkinIndex,
        bestTimes: this.bestTimes,
      };
      localStorage.setItem('minimalPlatformerSave', JSON.stringify(data));
    },
    /**
     * Load progress from localStorage if present.  Coins, skins
     * unlocked and best times are restored.  If nothing saved yet
     * default values are used.
     */
    loadProgress() {
      const saved = localStorage.getItem('minimalPlatformerSave');
      if (saved) {
        this.savedData = JSON.parse(saved);
        this.coins = this.savedData.coins || 0;
        this.bestTimes = this.savedData.bestTimes || {};
      } else {
        this.savedData = null;
        this.coins = 0;
        this.bestTimes = {};
      }
    },
    /**
     * Show the start menu overlay and hide others.  When the menu
     * is shown the game loop continues to run but nothing updates
     * or draws besides the UI and perhaps a background.  All
     * overlays share a similar mechanism: toggling the 'active'
     * class.
     */
    showMenu() {
      this.state = 'menu';
      startScreen.classList.add('active');
      pauseScreen.classList.remove('active');
      levelCompleteScreen.classList.remove('active');
      levelSelectScreen.classList.remove('active');
      skinsScreen.classList.remove('active');
    },
    /**
     * Start playing a specific level.  The chosen index is
     * validated then used to instantiate a Level and Player.  The
     * level start time and session coins are reset.  The playing
     * state triggers update and draw calls in the main loop.
     */
    startGame(levelIndex) {
      if (levelIndex < 0 || levelIndex >= this.levels.length) levelIndex = 0;
      this.currentLevelIndex = levelIndex;
      this.level = new Level(this.levels[levelIndex]);
      const spawnX = this.level.spawnX;
      const spawnY = this.level.spawnY;
      this.player = new Player(spawnX, spawnY - this.level.tileSize, this.getSelectedSkinColor());
      this.camera.x = 0;
      this.camera.y = 0;
      this.levelStartTime = performance.now();
      this.currentTime = 0;
      this.sessionCoins = 0;
      this.state = 'playing';
      // Hide overlays
      startScreen.classList.remove('active');
      pauseScreen.classList.remove('active');
      levelCompleteScreen.classList.remove('active');
      levelSelectScreen.classList.remove('active');
      skinsScreen.classList.remove('active');
    },
    /**
     * Reset the current level by reloading it and respawning the
     * player.  Coins collected in this level are not added to
     * total coins unless the level is completed.
     */
    resetLevel() {
      this.startGame(this.currentLevelIndex);
    },
    /**
     * Proceed to the next level or loop back to the first.  If
     * there are no more levels a simple message is displayed.
     */
    nextLevel() {
      const next = this.currentLevelIndex + 1;
      if (next < this.levels.length) {
        this.startGame(next);
      } else {
        // all levels done
        alert('You have completed all levels!');
        this.exitToMenu();
      }
    },
    /**
     * Exit to the main menu.  Coins collected in the current
     * attempt are lost (only coins from completed levels persist).
     */
    exitToMenu() {
      this.showMenu();
    },
    /**
     * Toggle the pause state.  When paused the update logic is
     * skipped but drawing continues.  Resuming hides the pause
     * overlay.
     */
    togglePause(forceOff = null) {
      if (this.state === 'playing' && (forceOff === null || forceOff === false)) {
        this.state = 'paused';
        pauseScreen.classList.add('active');
      } else if (this.state === 'paused' || forceOff === true) {
        this.state = 'playing';
        pauseScreen.classList.remove('active');
        this.levelStartTime = performance.now() - this.currentTime * 1000;
      }
    },
    /**
     * Show the level select overlay.  Build the UI when entering.
     */
    showLevelSelect() {
      this.state = 'levelSelect';
      this.buildLevelSelectUI();
      levelSelectScreen.classList.add('active');
      startScreen.classList.remove('active');
    },
    /**
     * Show the skins selection overlay and rebuild UI.
     */
    showSkins() {
      this.state = 'skins';
      this.buildSkinsUI();
      skinsScreen.classList.add('active');
      startScreen.classList.remove('active');
    },
    /**
     * Called by the player when a coin is collected.  Only coins
     * collected by finishing a level are saved.  The session coins
     * count is used for unlocking skins.
     */
    addCoin() {
      this.sessionCoins++;
    },
    /**
     * Called when the player reaches the flag.  Calculates level
     * completion time, updates best time if necessary, adds the
     * collected coins to the total and displays the completion
     * overlay.
     */
    completeLevel() {
      this.state = 'complete';
      const finishTime = (performance.now() - this.levelStartTime) / 1000;
      const levelIndex = this.currentLevelIndex;
      const best = this.bestTimes[levelIndex];
      if (best === undefined || finishTime < best) {
        this.bestTimes[levelIndex] = finishTime;
      }
      // add collected coins
      this.coins += this.sessionCoins;
      // Save progress
      this.saveProgress();
      // Display stats
      const timeStr = finishTime.toFixed(2);
      const bestStr = this.bestTimes[levelIndex].toFixed(2);
      timeStatsDiv.innerHTML = `Time: ${timeStr}s<br>Best: ${bestStr}s<br>Coins: +${this.sessionCoins}`;
      levelCompleteScreen.classList.add('active');
    },
    /**
     * Update and draw logic executed each animation frame.  The
     * loop does not stop when on menus; it simply avoids updating
     * the game world when not playing.  dt is passed as the
     * fractional number of 1/60 seconds that elapsed since the
     * previous frame.  This keeps motion consistent regardless of
     * frame rate.
     */
    loop(now) {
      const dtMs = now - this.lastFrame;
      // cap dt to avoid huge leaps when the tab is hidden
      const dt = Math.min(33, dtMs) / 16.6667; // ~60fps normalization
      this.lastFrame = now;
      // update
      if (this.state === 'playing') {
        // update time
        this.currentTime = (now - this.levelStartTime) / 1000;
        // update level hazards
        this.level.updateHazards(dt);
        // update player
        this.player.update(dt, this.level);
        // update camera to follow player
        this.updateCamera();
      }
      // draw
      this.draw();
      requestAnimationFrame((n) => this.loop(n));
    },
    /**
     * Update the camera position so that the player stays within
     * view.  Camera is clamped to the level bounds.
     */
    updateCamera() {
      const ts = this.level.tileSize;
      const levelWidth = this.level.cols * ts;
      const levelHeight = this.level.rows * ts;
      // center camera on player horizontally
      const targetX = this.player.x + this.player.width / 2 - canvas.width / 2;
      const targetY = this.player.y + this.player.height / 2 - canvas.height / 2;
      // clamp
      this.camera.x = Math.max(0, Math.min(targetX, levelWidth - canvas.width));
      this.camera.y = Math.max(0, Math.min(targetY, levelHeight - canvas.height));
    },
    /**
     * Render the game world and overlay HUD.  When on menus the
     * world can still be drawn in the background for effect.
     */
    draw() {
      // clear canvas
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // draw level behind menus
      if (this.level) {
        this.level.draw(ctx, this.camera);
      }
      // draw player if exists and not on menu
      if (this.player && this.state !== 'menu' && this.state !== 'levelSelect' && this.state !== 'skins') {
        this.player.draw(ctx, this.camera);
      }
      // HUD: current time and coin count when playing
      if (this.state === 'playing') {
        ctx.fillStyle = '#fff';
        ctx.font = '16px sans-serif';
        const timeDisplay = this.currentTime.toFixed(2);
        ctx.fillText(`Time: ${timeDisplay}s`, 10, 20);
        ctx.fillText(`Coins: ${this.coins + this.sessionCoins}`, 10, 40);
      }
    },
  };

  // Kick off the game once the page has loaded
  window.addEventListener('load', () => {
    Game.init();
  });
})();
