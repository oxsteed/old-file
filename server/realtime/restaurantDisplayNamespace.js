'use strict';

function bindRestaurantDisplayNamespace(namespace) {
  namespace.on('connection', (socket) => {
    socket.on('display:join', (restaurantId) => {
      const id = Number.parseInt(restaurantId, 10);
      if (Number.isInteger(id) && id > 0) socket.join(`rdisplay_${id}`);
    });

    socket.on('display:leave', (restaurantId) => {
      const id = Number.parseInt(restaurantId, 10);
      if (Number.isInteger(id) && id > 0) socket.leave(`rdisplay_${id}`);
    });
  });
}

module.exports = { bindRestaurantDisplayNamespace };
