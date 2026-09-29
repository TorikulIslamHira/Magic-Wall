using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MagicWall.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddApprovalWorkflow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Existing match events were entered by hand before the approval workflow existed:
            // they become Approved/Manual so the wall keeps showing them. (EF's generated ""
            // defaults would not parse as enums and would break every sports read.)
            migrationBuilder.AddColumn<string>(
                name: "ExternalId",
                table: "MatchEvents",
                type: "TEXT",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReviewedAt",
                table: "MatchEvents",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewedBy",
                table: "MatchEvents",
                type: "TEXT",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "MatchEvents",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "Manual");

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "MatchEvents",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "Approved");

            migrationBuilder.AddColumn<DateTime>(
                name: "SubmittedAt",
                table: "MatchEvents",
                type: "TEXT",
                nullable: false,
                defaultValue: new DateTime(2026, 9, 29, 0, 0, 0, 0, DateTimeKind.Utc));

            migrationBuilder.AddColumn<string>(
                name: "SubmittedBy",
                table: "MatchEvents",
                type: "TEXT",
                maxLength: 60,
                nullable: false,
                defaultValue: "legacy");

            migrationBuilder.AddColumn<string>(
                name: "FeedMatchId",
                table: "Matches",
                type: "TEXT",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ElectionResultSubmissions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ConstituencyId = table.Column<int>(type: "INTEGER", nullable: false),
                    CandidateId = table.Column<int>(type: "INTEGER", nullable: false),
                    VotesReceived = table.Column<int>(type: "INTEGER", nullable: false),
                    PreviousVotes = table.Column<int>(type: "INTEGER", nullable: true),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Note = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    SubmittedBy = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false),
                    SubmittedByName = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ReviewedBy = table.Column<string>(type: "TEXT", maxLength: 60, nullable: true),
                    ReviewedByName = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    ReviewNote = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ElectionResultSubmissions", x => x.Id);
                    table.CheckConstraint("CK_ElectionResultSubmission_Votes", "VotesReceived >= 0");
                    table.ForeignKey(
                        name: "FK_ElectionResultSubmissions_Candidates_CandidateId",
                        column: x => x.CandidateId,
                        principalTable: "Candidates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ElectionResultSubmissions_Constituencies_ConstituencyId",
                        column: x => x.ConstituencyId,
                        principalTable: "Constituencies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserName = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false),
                    DisplayName = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    PasswordHash = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Role = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MatchEvents_ExternalId",
                table: "MatchEvents",
                column: "ExternalId",
                unique: true,
                filter: "ExternalId IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_MatchEvents_Status_SubmittedAt",
                table: "MatchEvents",
                columns: new[] { "Status", "SubmittedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ElectionResultSubmissions_CandidateId",
                table: "ElectionResultSubmissions",
                column: "CandidateId");

            migrationBuilder.CreateIndex(
                name: "IX_ElectionResultSubmissions_ConstituencyId_CandidateId_Status",
                table: "ElectionResultSubmissions",
                columns: new[] { "ConstituencyId", "CandidateId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_ElectionResultSubmissions_Status_SubmittedAt",
                table: "ElectionResultSubmissions",
                columns: new[] { "Status", "SubmittedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Users_UserName",
                table: "Users",
                column: "UserName",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ElectionResultSubmissions");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropIndex(
                name: "IX_MatchEvents_ExternalId",
                table: "MatchEvents");

            migrationBuilder.DropIndex(
                name: "IX_MatchEvents_Status_SubmittedAt",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "ExternalId",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "ReviewedAt",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "ReviewedBy",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "SubmittedAt",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "SubmittedBy",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "FeedMatchId",
                table: "Matches");
        }
    }
}
