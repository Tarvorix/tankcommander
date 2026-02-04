import nipplejs from 'nipplejs';

export class Controls {
  constructor(tank, camera) {
    this.tank = tank;
    this.camera = camera;

    this.setupJoysticks();
    this.setupKeyboard();
    this.setupFireButton();
  }

  setupJoysticks() {
    // Left joystick - movement
    this.moveJoystick = nipplejs.create({
      zone: document.getElementById('joystick-left'),
      mode: 'static',
      position: { left: '60px', bottom: '60px' },
      color: 'white',
      size: 100
    });

    this.moveJoystick.on('move', (evt, data) => {
      const x = data.vector.x;
      const y = data.vector.y;
      this.tank.setMoveInput(x, y);
    });

    this.moveJoystick.on('end', () => {
      this.tank.setMoveInput(0, 0);
    });

    // Right joystick - turret
    this.turretJoystick = nipplejs.create({
      zone: document.getElementById('joystick-right'),
      mode: 'static',
      position: { right: '140px', bottom: '60px' },
      color: 'red',
      size: 100
    });

    this.turretJoystick.on('move', (evt, data) => {
      const x = data.vector.x;
      this.tank.setTurretInput(x, 0);
    });

    this.turretJoystick.on('end', () => {
      this.tank.setTurretInput(0, 0);
    });
  }

  setupKeyboard() {
    const keys = {};

    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      this.updateFromKeys(keys);

      // Fire with space
      if (e.code === 'Space') {
        this.tank.fire();
      }
    });

    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
      this.updateFromKeys(keys);
    });
  }

  updateFromKeys(keys) {
    // WASD for movement
    let moveX = 0;
    let moveY = 0;

    if (keys['KeyW']) moveY = 1;
    if (keys['KeyS']) moveY = -1;
    if (keys['KeyA']) moveX = -1;
    if (keys['KeyD']) moveX = 1;

    this.tank.setMoveInput(moveX, moveY);

    // Q/E for turret
    let turretX = 0;
    if (keys['KeyQ']) turretX = -1;
    if (keys['KeyE']) turretX = 1;

    this.tank.setTurretInput(turretX, 0);
  }

  setupFireButton() {
    const fireBtn = document.getElementById('fire-button');

    // Touch
    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.tank.fire();
    });

    // Mouse
    fireBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.tank.fire();
    });
  }
}
