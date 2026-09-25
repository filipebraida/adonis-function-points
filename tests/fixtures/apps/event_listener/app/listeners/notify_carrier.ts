import type ShipmentReady from '#events/shipment_ready'
import CarrierNotice from '#models/carrier_notice'

export default class NotifyCarrier {
  /** Named by the binding, not by convention. */
  async onShipment(event: ShipmentReady) {
    await CarrierNotice.create({ orderId: event.orderId })
  }
}
