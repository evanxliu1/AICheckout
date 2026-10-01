import { Icon } from '@ai-checkout/ui';

export default function PopupHeader() {
  return (
    <header className="popup-header">
      <Icon name="shopping-cart" size={24} className="text-action" />
      <div>
        <h1 className="popup-title">AI Checkout</h1>
        <p className="supporting">Compare rewards on cards you own.</p>
      </div>
    </header>
  );
}
