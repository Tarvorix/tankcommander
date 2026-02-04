import nipplejs from 'nipplejs';

export class Controls {
  constructor(vehicle, camera) {
    this.vehicle = vehicle;
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
      position: { left: '50%', top: '50%' },
      color: 'white',
      size: 100
    });

    this.moveJoystick.on('move', (evt, data) => {
      const x = data.vector.x;
      const y = data.vector.y;
      this.vehicle.setMoveInput(x, y);
    });

    this.moveJoystick.on('end', () => {
      this.vehicle.setMoveInput(0, 0);
    });

    // Right joystick - turret
    this.turretJoystick = nipplejs.create({
      zone: document.getElementById('joystick-right'),
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'red',
      size: 100
    });

    this.turretJoystick.on('move', (evt, data) => {
      const x = data.vector.x;
      this.vehicle.setTurretInput(x, 0);
    });

    this.turretJoystick.on('end', () => {
      this.vehicle.setTurretInput(0, 0);
    });
  }

  setupKeyboard() {
    const keys = {};

    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      this.updateFromKeys(keys);

      // Fire with space
      if (e.code === 'Space') {
        this.vehicle.fire();
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

    this.vehicle.setMoveInput(moveX, moveY);

    // Q/E for turret
    let turretX = 0;
    if (keys['KeyQ']) turretX = -1;
    if (keys['KeyE']) turretX = 1;

    this.vehicle.setTurretInput(turretX, 0);
  }

  setupFireButton() {
    const fireBtn = document.getElementById('fire-button');

    // Touch
    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.vehicle.fire();
    });

    // Mouse
    fireBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.vehicle.fire();
    });
  }
}
