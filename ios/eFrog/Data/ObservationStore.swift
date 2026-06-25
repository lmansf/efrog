import CoreData
import Foundation

// MARK: - ObservationStore
//
// CoreData-backed local observation history. Replaces DuckDB-WASM (js/db.js) and
// localStorage (js/store.js) from the web app.
//
// The CoreData model is defined programmatically so no `.xcdatamodeld` file is required
// for compilation. The entity schema matches js/store.js lines 85–89:
//   id, species, confidence, timestamp, audioPath, synced, userId
//
// Usage:
//   let store = ObservationStore.shared
//   try store.save(observation)
//   let all = try store.fetchAll()

final class ObservationStore {

    // MARK: - Singleton

    static let shared = ObservationStore()

    // MARK: - CoreData stack

    private let container: NSPersistentContainer

    private var context: NSManagedObjectContext {
        container.viewContext
    }

    private init() {
        container = NSPersistentContainer(
            name: "eFrog",
            managedObjectModel: ObservationStore.makeModel()
        )
        container.loadPersistentStores { _, error in
            if let error {
                // Fatal: CoreData is required for local history.
                fatalError("ObservationStore failed to load persistent store: \(error)")
            }
        }
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
    }

    // MARK: - Public API

    /// Persist an observation locally. Overwrites any existing row with the same id.
    /// Mirrors Store.addEntry / Store.importEntries from js/store.js.
    func save(_ obs: Observation) throws {
        let entity: ObservationEntity = fetchEntity(id: obs.id) ?? ObservationEntity(context: context)
        entity.id         = obs.id
        entity.species    = obs.species
        entity.confidence = obs.confidence
        entity.timestamp  = obs.timestamp
        entity.audioPath  = obs.audioPath
        entity.synced     = obs.synced
        entity.userId     = obs.userId
        try context.save()
    }

    /// Return all observations sorted newest-first.
    /// Mirrors DB.getObservations / Store.getHistory from the web app.
    func fetchAll() throws -> [Observation] {
        let request = ObservationEntity.fetchRequest()
        request.sortDescriptors = [NSSortDescriptor(key: "timestamp", ascending: false)]
        let entities = try context.fetch(request)
        return entities.map { $0.toObservation() }
    }

    /// Mark an observation as successfully synced to Supabase.
    /// Mirrors the synced flag managed in js/db.js feedback table.
    func markSynced(id: String) throws {
        guard let entity = fetchEntity(id: id) else { return }
        entity.synced = true
        try context.save()
    }

    /// Delete all locally stored observations. Mirrors Store.clearHistory from js/store.js.
    func deleteAll() throws {
        let request = NSFetchRequest<NSFetchRequestResult>(entityName: ObservationEntity.entityName)
        let delete = NSBatchDeleteRequest(fetchRequest: request)
        try context.execute(delete)
        try context.save()
    }

    // MARK: - Private helpers

    private func fetchEntity(id: String) -> ObservationEntity? {
        let request = ObservationEntity.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id)
        request.fetchLimit = 1
        return try? context.fetch(request).first
    }

    // MARK: - Programmatic CoreData model
    //
    // Defined here so the app compiles without a `.xcdatamodeld` file.
    // If you add one in Xcode, remove this method and use the GUI model instead
    // (ensure the entity and attribute names match exactly).

    private static func makeModel() -> NSManagedObjectModel {
        let model = NSManagedObjectModel()

        let entity = NSEntityDescription()
        entity.name = ObservationEntity.entityName
        entity.managedObjectClassName = NSStringFromClass(ObservationEntity.self)

        func attr(_ name: String, type: NSAttributeType, optional: Bool = false) -> NSAttributeDescription {
            let a = NSAttributeDescription()
            a.name = name
            a.attributeType = type
            a.isOptional = optional
            return a
        }

        entity.properties = [
            attr("id",         type: .stringAttributeType),
            attr("species",    type: .stringAttributeType),
            attr("confidence", type: .doubleAttributeType),
            attr("timestamp",  type: .dateAttributeType),
            attr("audioPath",  type: .stringAttributeType, optional: true),
            attr("synced",     type: .booleanAttributeType),
            attr("userId",     type: .stringAttributeType, optional: true),
        ]

        model.entities = [entity]
        return model
    }
}

// MARK: - ObservationEntity

/// NSManagedObject subclass for the local `ObservationEntity` CoreData entity.
/// Properties match js/store.js history record structure (lines 85–89).
@objc(ObservationEntity)
private final class ObservationEntity: NSManagedObject {

    static let entityName = "ObservationEntity"

    @NSManaged var id: String
    @NSManaged var species: String
    @NSManaged var confidence: Double
    @NSManaged var timestamp: Date
    @NSManaged var audioPath: String?
    @NSManaged var synced: Bool
    @NSManaged var userId: String?

    static func fetchRequest() -> NSFetchRequest<ObservationEntity> {
        NSFetchRequest<ObservationEntity>(entityName: entityName)
    }

    func toObservation() -> Observation {
        Observation(
            id: id,
            userId: userId,
            timestamp: timestamp,
            species: species,
            confidence: confidence,
            audioPath: audioPath,
            synced: synced
        )
    }
}
