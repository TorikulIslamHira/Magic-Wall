using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MagicWall.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BudgetSectors",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    TotalAllocation = table.Column<double>(type: "REAL", nullable: false),
                    FiscalYear = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BudgetSectors", x => x.Id);
                    table.CheckConstraint("CK_BudgetSector_Allocation", "TotalAllocation >= 0");
                });

            migrationBuilder.CreateTable(
                name: "Candidates",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    PartyName = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    Symbol = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Candidates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ConflictZones",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    RegionName = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    SvgPathId = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConflictZones", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Constituencies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    SvgPathId = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    TotalVoters = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Constituencies", x => x.Id);
                    table.CheckConstraint("CK_Constituency_TotalVoters", "TotalVoters >= 0");
                });

            migrationBuilder.CreateTable(
                name: "Matches",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Title = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Sport = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    MatchDate = table.Column<DateTime>(type: "TEXT", nullable: false),
                    TeamA = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    TeamB = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Matches", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Players",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    Team = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    Role = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Players", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MegaProjects",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    BudgetSectorId = table.Column<int>(type: "INTEGER", nullable: false),
                    BudgetAmount = table.Column<double>(type: "REAL", nullable: false),
                    CompletionPercentage = table.Column<double>(type: "REAL", nullable: false),
                    GeoLocation = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MegaProjects", x => x.Id);
                    table.CheckConstraint("CK_MegaProject_Amount", "BudgetAmount >= 0");
                    table.CheckConstraint("CK_MegaProject_Completion", "CompletionPercentage BETWEEN 0 AND 100");
                    table.ForeignKey(
                        name: "FK_MegaProjects_BudgetSectors_BudgetSectorId",
                        column: x => x.BudgetSectorId,
                        principalTable: "BudgetSectors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TimelineEvents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ConflictZoneId = table.Column<int>(type: "INTEGER", nullable: false),
                    Date = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    ControllingForce = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    Casualties = table.Column<int>(type: "INTEGER", nullable: false),
                    Description = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TimelineEvents", x => x.Id);
                    table.CheckConstraint("CK_TimelineEvent_Casualties", "Casualties >= 0");
                    table.ForeignKey(
                        name: "FK_TimelineEvents_ConflictZones_ConflictZoneId",
                        column: x => x.ConflictZoneId,
                        principalTable: "ConflictZones",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ElectionResults",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ConstituencyId = table.Column<int>(type: "INTEGER", nullable: false),
                    CandidateId = table.Column<int>(type: "INTEGER", nullable: false),
                    VotesReceived = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ElectionResults", x => x.Id);
                    table.CheckConstraint("CK_ElectionResult_Votes", "VotesReceived >= 0");
                    table.ForeignKey(
                        name: "FK_ElectionResults_Candidates_CandidateId",
                        column: x => x.CandidateId,
                        principalTable: "Candidates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ElectionResults_Constituencies_ConstituencyId",
                        column: x => x.ConstituencyId,
                        principalTable: "Constituencies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MatchEvents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    MatchId = table.Column<int>(type: "INTEGER", nullable: false),
                    PlayerId = table.Column<int>(type: "INTEGER", nullable: false),
                    EventType = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    CoordinateX = table.Column<float>(type: "REAL", nullable: false),
                    CoordinateY = table.Column<float>(type: "REAL", nullable: false),
                    EndCoordinateX = table.Column<float>(type: "REAL", nullable: true),
                    EndCoordinateY = table.Column<float>(type: "REAL", nullable: true),
                    Minute = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MatchEvents", x => x.Id);
                    table.CheckConstraint("CK_MatchEvent_EndX", "EndCoordinateX IS NULL OR EndCoordinateX BETWEEN 0 AND 100");
                    table.CheckConstraint("CK_MatchEvent_EndY", "EndCoordinateY IS NULL OR EndCoordinateY BETWEEN 0 AND 100");
                    table.CheckConstraint("CK_MatchEvent_Minute", "Minute >= 0");
                    table.CheckConstraint("CK_MatchEvent_X", "CoordinateX BETWEEN 0 AND 100");
                    table.CheckConstraint("CK_MatchEvent_Y", "CoordinateY BETWEEN 0 AND 100");
                    table.ForeignKey(
                        name: "FK_MatchEvents_Matches_MatchId",
                        column: x => x.MatchId,
                        principalTable: "Matches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MatchEvents_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BudgetSectors_FiscalYear_Name",
                table: "BudgetSectors",
                columns: new[] { "FiscalYear", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Candidates_PartyName",
                table: "Candidates",
                column: "PartyName");

            migrationBuilder.CreateIndex(
                name: "IX_ConflictZones_RegionName",
                table: "ConflictZones",
                column: "RegionName");

            migrationBuilder.CreateIndex(
                name: "IX_ConflictZones_SvgPathId",
                table: "ConflictZones",
                column: "SvgPathId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Constituencies_SvgPathId",
                table: "Constituencies",
                column: "SvgPathId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ElectionResults_CandidateId",
                table: "ElectionResults",
                column: "CandidateId");

            migrationBuilder.CreateIndex(
                name: "IX_ElectionResults_ConstituencyId_CandidateId",
                table: "ElectionResults",
                columns: new[] { "ConstituencyId", "CandidateId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Matches_MatchDate",
                table: "Matches",
                column: "MatchDate");

            migrationBuilder.CreateIndex(
                name: "IX_MatchEvents_MatchId_PlayerId_Minute",
                table: "MatchEvents",
                columns: new[] { "MatchId", "PlayerId", "Minute" });

            migrationBuilder.CreateIndex(
                name: "IX_MatchEvents_PlayerId",
                table: "MatchEvents",
                column: "PlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_MegaProjects_BudgetSectorId",
                table: "MegaProjects",
                column: "BudgetSectorId");

            migrationBuilder.CreateIndex(
                name: "IX_Players_Team",
                table: "Players",
                column: "Team");

            migrationBuilder.CreateIndex(
                name: "IX_TimelineEvents_ConflictZoneId_Date",
                table: "TimelineEvents",
                columns: new[] { "ConflictZoneId", "Date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ElectionResults");

            migrationBuilder.DropTable(
                name: "MatchEvents");

            migrationBuilder.DropTable(
                name: "MegaProjects");

            migrationBuilder.DropTable(
                name: "TimelineEvents");

            migrationBuilder.DropTable(
                name: "Candidates");

            migrationBuilder.DropTable(
                name: "Constituencies");

            migrationBuilder.DropTable(
                name: "Matches");

            migrationBuilder.DropTable(
                name: "Players");

            migrationBuilder.DropTable(
                name: "BudgetSectors");

            migrationBuilder.DropTable(
                name: "ConflictZones");
        }
    }
}
