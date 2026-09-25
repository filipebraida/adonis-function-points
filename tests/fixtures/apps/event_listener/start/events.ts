import emitter from '@adonisjs/core/services/emitter'

import ShipmentReady from '#events/shipment_ready'
import { events } from '#generated/events'
import { listeners } from '#generated/listeners'

/** through the generated registries, which is what `make:event` produces */
emitter.on(events.OrderPlaced, [listeners.ReserveStock])

/**
 * The direct form, and with the method named by the binding. Taking `handle` on
 * faith here would look for a body that is not the one bound.
 */
emitter.on(ShipmentReady, [[listeners.NotifyCarrier, 'onShipment']])
