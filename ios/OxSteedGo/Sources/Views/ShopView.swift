import SwiftUI

struct ShopView: View {
    @Environment(GoStore.self) private var store

    private let items = [
        (title: GoCopyKey.shopItemLeakRepairKit, subtitle: GoCopyKey.shopItemLeakRepairKitDescription, price: "$24"),
        (title: GoCopyKey.shopItemStudFinder, subtitle: GoCopyKey.shopItemStudFinderDescription, price: "$31"),
        (title: GoCopyKey.shopItemMovingStraps, subtitle: GoCopyKey.shopItemMovingStrapsDescription, price: "$14"),
        (title: GoCopyKey.shopItemTrashBags, subtitle: GoCopyKey.shopItemTrashBagsDescription, price: "$18")
    ]

    private func t(_ key: GoCopyKey) -> String {
        GoLocalization.text(key, language: store.appLanguage)
    }

    var body: some View {
        @Bindable var store = store

        GoScreen(title: t(.shop)) {
            GoCard {
                Text(t(.shopSkillAwareShopping))
                    .font(.largeTitle.bold())
                Text(t(.shopDescription))
                    .font(.headline)
                    .foregroundStyle(.secondary)
                TextField(t(.shopSearchMarketplace), text: $store.searchText)
                    .textFieldStyle(.roundedBorder)
                Button(t(.shopLoadProducts)) {
                    Task { await store.loadProducts() }
                }
                .buttonStyle(.borderedProminent)
                .tint(GoTheme.sea)
            }

            switch store.products {
            case .idle:
                ForEach(items, id: \.0) { item in
                    ProductPreviewRow(
                        title: t(item.title),
                        subtitle: t(item.subtitle),
                        price: item.price
                    )
                }
            case .loading:
                GoCard { ProgressView(t(.shopLoadingProducts)) }
            case .failed(let message):
                GoCard {
                    Text(message)
                        .foregroundStyle(.red)
                    Button(t(.shopRetry)) { Task { await store.loadProducts() } }
                }
            case .loaded(let products):
                ForEach(products.prefix(20)) { product in
                    ProductPreviewRow(
                        title: product.name ?? t(.shopUnnamedProduct),
                        subtitle: product.description ?? product.category ?? t(.shopMarketplaceItem),
                        price: product.priceText
                    )
                }
            }
        }
        .task {
            await store.loadProducts()
        }
    }
}

private struct ProductPreviewRow: View {
    let title: String
    let subtitle: String
    let price: String

    var body: some View {
                GoCard {
                    HStack {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(title)
                                .font(.headline)
                            Text(subtitle)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(price)
                            .font(.headline.bold())
                            .foregroundStyle(GoTheme.sea)
                    }
                }
    }
}
