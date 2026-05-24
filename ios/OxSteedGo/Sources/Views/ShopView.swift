import SwiftUI

struct ShopView: View {
    @Environment(GoStore.self) private var store

    private let items = [
        ("Leak repair kit", "For sink, faucet, and small pipe fixes", "$24"),
        ("Stud finder", "Useful for shelves, mounts, and cabinets", "$31"),
        ("Moving straps", "Rental-friendly logistics helper", "$14"),
        ("Contractor trash bags", "Common add-on for cleanup jobs", "$18")
    ]

    var body: some View {
        @Bindable var store = store

        GoScreen(title: "Shop") {
            GoCard {
                Text("Skill-Aware Shopping")
                    .font(.largeTitle.bold())
                Text("A simpler user app surface for the marketplace: supplies, tools, rentals, and recommended lists tied to a job draft.")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                TextField("Search marketplace", text: $store.searchText)
                    .textFieldStyle(.roundedBorder)
                Button("Load Products") {
                    Task { await store.loadProducts() }
                }
                .buttonStyle(.borderedProminent)
                .tint(GoTheme.sea)
            }

            switch store.products {
            case .idle:
                ForEach(items, id: \.0) { item in
                    ProductPreviewRow(title: item.0, subtitle: item.1, price: item.2)
                }
            case .loading:
                GoCard { ProgressView("Loading products") }
            case .failed(let message):
                GoCard {
                    Text(message)
                        .foregroundStyle(.red)
                    Button("Retry") { Task { await store.loadProducts() } }
                }
            case .loaded(let products):
                ForEach(products.prefix(20)) { product in
                    ProductPreviewRow(
                        title: product.name ?? "Unnamed product",
                        subtitle: product.description ?? product.category ?? "Marketplace item",
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
