module BoatPon.FableRenderer.Renderer

open Fable.Core
open Fable.Core.JsInterop

// Real Fable Rendererは表示済み契約だけを受け取り、ROI・採否・状態遷移を再計算しない。
// domain / server / scripts / DBへの依存は禁止する。

[<Erase>]
type OpportunityPresentation =
    abstract score: float
    abstract scoreLabel: string
    abstract riskLevel: string
    abstract summary: string

[<Erase>]
type ResearchHypothesis =
    abstract id: string
    abstract name: string
    abstract description: string
    abstract status: string
    abstract priority: int
    abstract adoptionAllowed: bool
    abstract adoptionBlockReason: string
    abstract nextAction: string
    abstract gateStatus: obj
    abstract lastKnownMetrics: obj
    abstract dataReadiness: obj
    abstract requiredData: string array
    abstract nextReviewTrigger: string

[<Erase>]
type ResearchHypothesisRegistry =
    abstract hypotheses: ResearchHypothesis array

[<Erase>]
type LiveCandidateHealth =
    abstract candidateRows: int
    abstract racePrograms: int

let private riskColor riskLevel =
    match riskLevel with
    | "low" -> "#2f9e44"
    | "medium" -> "#e0a300"
    | "high" -> "#d13b3b"
    | _ -> "#8a8a94"

let private statusTone (status: string) adoptionAllowed =
    if adoptionAllowed then "eligible"
    elif status.Contains("rejected") || status = "frozen" then "muted"
    else
        match status with
        | "monitor" | "waiting-data" -> "watch"
        | _ -> "research"

let renderOpportunity (opportunity: OpportunityPresentation) (warningsCount: int) : obj =
    createObj [
        "score" ==> opportunity.score
        "scoreLabel" ==> opportunity.scoreLabel
        "riskLevel" ==> opportunity.riskLevel
        "riskColor" ==> riskColor opportunity.riskLevel
        "summary" ==> opportunity.summary
        "warningsCount" ==> warningsCount
    ]

let renderHypothesis (hypothesis: ResearchHypothesis) : obj =
    createObj [
        "id" ==> hypothesis.id
        "name" ==> hypothesis.name
        "description" ==> hypothesis.description
        "status" ==> hypothesis.status
        "priority" ==> hypothesis.priority
        "adoptionAllowed" ==> hypothesis.adoptionAllowed
        "adoptionBlockReason" ==> hypothesis.adoptionBlockReason
        "nextAction" ==> hypothesis.nextAction
        "gateStatus" ==> hypothesis.gateStatus
        "lastKnownMetrics" ==> hypothesis.lastKnownMetrics
        "dataReadiness" ==> hypothesis.dataReadiness
        "requiredData" ==> hypothesis.requiredData
        "nextReviewTrigger" ==> hypothesis.nextReviewTrigger
        "tone" ==> statusTone hypothesis.status hypothesis.adoptionAllowed
    ]

let renderHypothesisBoard (registry: ResearchHypothesisRegistry) : obj =
    let hypotheses = registry.hypotheses
    let countBy predicate = hypotheses |> Array.filter predicate |> Array.length

    createObj [
        "cards" ==> (hypotheses |> Array.sortBy (fun item -> item.priority) |> Array.map renderHypothesis)
        "summary" ==> createObj [
            "total" ==> hypotheses.Length
            "adoptionAllowed" ==> countBy (fun item -> item.adoptionAllowed)
            "blocked" ==> countBy (fun item -> not item.adoptionAllowed)
            "monitoring" ==> countBy (fun item -> item.status = "monitor" || item.status = "waiting-data" || item.status = "testing-historical")
            "rejected" ==> countBy (fun item -> item.status.Contains("rejected") || item.status = "frozen")
        ]
    ]

let renderLiveCandidateHealth (health: LiveCandidateHealth) : obj =
    let rowsPerRace =
        if health.racePrograms <= 0 then 0.0
        else float health.candidateRows / float health.racePrograms
    let hasMultiplicity = health.candidateRows > health.racePrograms

    createObj [
        "candidateRows" ==> health.candidateRows
        "racePrograms" ==> health.racePrograms
        "rowsPerRace" ==> rowsPerRace
        "hasMultiplicity" ==> hasMultiplicity
        "tone" ==> (if hasMultiplicity then "attention" else "ok")
    ]
